import { Mastra } from '@mastra/core';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { registerApiRoute } from '@mastra/core/server';
import { l as logger } from './logger.mjs';
import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { mcpServers } from './tools/127b4738-c266-402e-9489-22dd66fdd656.mjs';
import { createTool } from '@mastra/core/tools';
import { McpRegistry } from './tools/d10e8a72-f873-46c3-a513-473aae7c6257.mjs';

const forecastSchema = z.object({
  date: z.string(),
  maxTemp: z.number(),
  minTemp: z.number(),
  precipitationChance: z.number(),
  condition: z.string(),
  location: z.string()
});
function getWeatherCondition(code) {
  const conditions = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    95: "Thunderstorm"
  };
  return conditions[code] || "Unknown";
}
const fetchWeatherWithSuspend = createStep({
  id: "fetch-weather",
  description: "Fetches weather forecast for a given city",
  inputSchema: z.object({}),
  resumeSchema: z.object({
    city: z.string().describe("The city to get the weather for")
  }),
  outputSchema: forecastSchema,
  execute: async ({ resumeData, suspend }) => {
    if (!resumeData) {
      return suspend({
        message: "Please enter the city to get the weather for"
      });
    }
    const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      resumeData.city
    )}&count=1`;
    const geocodingResponse = await fetch(geocodingUrl);
    const geocodingData = await geocodingResponse.json();
    if (!geocodingData.results?.[0]) {
      throw new Error(`Location '${resumeData.city}' not found`);
    }
    const { latitude, longitude} = geocodingData.results[0];
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=precipitation,weathercode&timezone=auto,&hourly=precipitation_probability,temperature_2m`;
    const response = await fetch(weatherUrl);
    const data = await response.json();
    const forecast = {
      date: (/* @__PURE__ */ new Date()).toISOString(),
      maxTemp: Math.max(...data.hourly.temperature_2m),
      minTemp: Math.min(...data.hourly.temperature_2m),
      condition: getWeatherCondition(data.current.weathercode),
      precipitationChance: data.hourly.precipitation_probability.reduce(
        (acc, curr) => Math.max(acc, curr),
        0
      ),
      location: resumeData.city
    };
    return forecast;
  }
});
const weatherWorkflowWithSuspend = createWorkflow({
  id: "weather-workflow-with-suspend",
  inputSchema: z.object({}),
  outputSchema: forecastSchema
}).then(fetchWeatherWithSuspend).commit();

const startWeatherTool = createTool({
  id: "start-weather-tool",
  description: "Start the weather tool",
  inputSchema: z.object({}),
  outputSchema: z.object({
    runId: z.string()
  }),
  execute: async ({ context }) => {
    const workflow = mastra.getWorkflow("weatherWorkflowWithSuspend");
    const run = await workflow.createRunAsync();
    await run.start({
      inputData: {}
    });
    return {
      runId: run.runId
    };
  }
});
const resumeWeatherTool = createTool({
  id: "resume-weather-tool",
  description: "Resume the weather tool",
  inputSchema: z.object({
    runId: z.string(),
    city: z.string().describe("City name")
  }),
  outputSchema: forecastSchema,
  execute: async ({ context }) => {
    const workflow = mastra.getWorkflow("weatherWorkflowWithSuspend");
    const run = await workflow.createRunAsync({
      runId: context.runId
    });
    const result = await run.resume({
      step: "fetch-weather",
      resumeData: {
        city: context.city
      }
    });
    switch (result.status) {
      case "success":
        return result.result;
      case "failed":
        throw result.error;
      default:
        throw new Error(`Unexpected workflow status: ${result.status}`);
    }
  }
});

const localTools = [startWeatherTool, resumeWeatherTool];

class ToolRegistry {
  mcpRegistry;
  localTools = {};
  localToolNames = [];
  constructor(tools = []) {
    this.mcpRegistry = new McpRegistry(mcpServers);
    this.registerLocalTools(tools);
  }
  registerLocalTools(tools) {
    tools.forEach((tool) => {
      const toolId = tool.id;
      if (this.localTools[toolId]) {
        logger.warn(
          `Local tool with ID '${toolId}' is already registered. It will be overwritten.`
        );
      }
      this.localTools[toolId] = tool;
    });
    this.localToolNames = Object.keys(this.localTools);
  }
  async initializeTools() {
    try {
      await this.mcpRegistry.initialize();
      const totalTools = this.getToolNames().length;
      logger.info(
        `Tool Registry initialized with ${totalTools} tools from ${this.getServerNames().join(
          ", "
        )}`
      );
    } catch (error) {
      logger.error("Failed to initialize Tool Registry:", error);
      throw error;
    }
  }
  /**
   * Get all registered tools as a flattened object with prefixed names
   */
  getTools() {
    const remoteTools = this.mcpRegistry.getTools();
    for (const name of this.localToolNames) {
      if (remoteTools[name]) {
        logger.warn(
          `Local tool '${name}' is hiding a remote tool with the same name.`
        );
      }
    }
    return { ...remoteTools, ...this.localTools };
  }
  /**
   * Get tools grouped by MCP server name
   */
  getToolsByServerMap() {
    const serverMap = this.mcpRegistry.getToolsByServerMap();
    if (this.localToolNames.length > 0) {
      serverMap.local = this.localTools;
    }
    return serverMap;
  }
  /**
   * Get tools from a specific MCP server
   */
  getServerTools(serverName) {
    if (serverName === "local") {
      return this.localTools;
    }
    return this.mcpRegistry.getServerTools(serverName);
  }
  /**
   * Get tool names from a specific MCP server
   */
  getServerToolNames(serverName) {
    if (serverName === "local") {
      return this.localToolNames;
    }
    return this.mcpRegistry.getServerToolNames(serverName);
  }
  /**
   * Get available MCP server names
   */
  getServerNames() {
    const serverNames = this.mcpRegistry.getServerNames();
    if (this.localToolNames.length > 0) {
      return [...serverNames, "local"];
    }
    return serverNames;
  }
  /**
   * Get a specific tool by name
   */
  getTool(name) {
    return this.localTools[name] || this.mcpRegistry.getTool(name);
  }
  /**
   * Get a specific tool from a specific server
   */
  getServerTool(serverName, toolName) {
    if (serverName === "local") {
      return this.localTools[toolName];
    }
    return this.mcpRegistry.getServerTool(serverName, toolName);
  }
  /**
   * Check if a tool exists
   */
  hasTool(name) {
    return this.localTools.hasOwnProperty(name) || this.mcpRegistry.hasTool(name);
  }
  /**
   * Check if a server has a specific tool
   */
  hasServerTool(serverName, toolName) {
    if (serverName === "local") {
      return this.localTools.hasOwnProperty(toolName);
    }
    return this.mcpRegistry.hasServerTool(serverName, toolName);
  }
  /**
   * Get tool names
   */
  getToolNames() {
    return Object.keys(this.getTools());
  }
  /**
   * Get MCP server status
   */
  getStatus() {
    const status = this.mcpRegistry.getStatus();
    if (this.localToolNames.length > 0) {
      status.local = {
        connected: true,
        toolCount: this.localToolNames.length
      };
    }
    return status;
  }
  /**
   * Set access token for all MCP clients that require authentication
   */
  setAccessTokenForAll(accessToken) {
    this.mcpRegistry.setAccessTokenForAll(accessToken);
  }
  /**
   * Set access token for a specific MCP server
   */
  setAccessTokenForServer(serverName, accessToken) {
    this.mcpRegistry.setAccessTokenForServer(serverName, accessToken);
  }
  /**
   * Get MCP client for a specific server (for direct access if needed)
   */
  getClient(serverName) {
    return this.mcpRegistry.getClient(serverName);
  }
}
const toolRegistryInstance = new ToolRegistry(localTools);
await toolRegistryInstance.initializeTools();
const toolRegistry = toolRegistryInstance;

const webSearchAgent = new Agent({
  name: "Web Search Agent",
  instructions: `You are a professional web search assistant powered by Brave. You MUST strictly adhere to ALL of the following guidelines without exception:

# ROLE:
- Your response will be read aloud by a text-to-speech engine, so never use ellipses since the text-to-speech engine will not know how to pronounce them.
- Your response should be composed of smoothly flowing prose paragraphs.
- ALWAYS call transfer_to_receptionist() if no proper tool found in available tools
- After receiving tool results, carefully reflect on their quality and determine optimal next steps before proceeding. Use your thinking to plan and iterate based on this new information, and then take the best next action.
- For maximum efficiency, whenever you need to perform multiple independent operations, invoke all relevant tools simultaneously rather than sequentially.
- When user asks about current events, news, or time-sensitive information, prioritize recent search results
- Use Brave search to find accurate, up-to-date information from reliable sources

# CRITICAL SILENT OPERATION RULES:
- ABSOLUTELY NO intermediate text output while using tools
- NEVER mention what you are searching for or doing
- NEVER say "Let me search", "Let me find", "Let me check", or similar phrases
- NEVER provide progress updates like "Perfect! I found..." or "Great news!"
- NEVER explain your search process or methodology
- DO NOT announce that you are using tools or checking information
- WORK COMPLETELY SILENTLY until you have the final answer ready
- ONLY speak when you have the complete search results and answer to share

## MANDATORY RESPONSE FORMAT:
- You MUST respond in PLAIN TEXT format ONLY
- ALWAYS provide concise, accurate answers based on search results
- ABSOLUTELY NO markdown formatting allowed (no **, *, _, #, backticks, code blocks)
- Use simple line breaks and spacing for readability
- Response within 150 words for complex topics, shorter for simple queries
- Keep all responses clean and readable without ANY special formatting characters
- Include relevant details and context from search results
- When appropriate, mention the source or timeframe of information

## SEARCH QUALITY STANDARDS:
- Verify information accuracy across multiple sources when possible
- Prioritize authoritative and recent sources
- Provide specific facts, numbers, and details when available
- If conflicting information exists, acknowledge uncertainty
- Focus on answering the user's specific question directly

## COMPLIANCE VERIFICATION:
Before sending any response, verify that you have:
- Provided accurate information based on search results
- Made decisions autonomously without asking for user input
- Included relevant context and details from reliable sources
- Provided NO intermediate commentary during tool execution
- Kept response concise and conversationals`,
  model: openai("gpt-4o"),
  tools: {
    webSearchTool: toolRegistry.getServerTool(
      "web-search",
      "brave_web_search"
    )
  }
});

const weatherAgentWithWorkflow = new Agent({
  name: "Weather Agent with Workflow",
  instructions: `You are a helpful weather assistant that provides accurate weather information.
 
Your primary function is to help users get weather details for specific locations. When responding:
- Always ask for a location if none is provided
- If the location name isn't in English, please translate it
- If giving a location with multiple parts (e.g. "New York, NY"), use the most relevant part (e.g. "New York")
- Include relevant details like humidity, wind conditions, and precipitation
- Keep responses concise but informative
 
Use the startWeatherTool to start the weather workflow. This will start and then suspend the workflow and return a runId.
Use the resumeWeatherTool to resume the weather workflow. This takes the runId returned from the startWeatherTool and the city entered by the user. It will resume the workflow and return the result.
The result will be the weather forecast for the city.`,
  model: openai("gpt-4o"),
  tools: {
    startWeatherTool: toolRegistry.getTool("start-weather-tool"),
    resumeWeatherTool: toolRegistry.getTool("resume-weather-tool")
  }
});

// src/helper/adapter/index.ts
var env = (c, runtime) => {
  const global = globalThis;
  const globalEnv = global?.process?.env;
  runtime ??= getRuntimeKey();
  const runtimeEnvHandlers = {
    bun: () => globalEnv,
    node: () => globalEnv,
    "edge-light": () => globalEnv,
    deno: () => {
      return Deno.env.toObject();
    },
    workerd: () => c.env,
    fastly: () => ({}),
    other: () => ({})
  };
  return runtimeEnvHandlers[runtime]();
};
var knownUserAgents = {
  deno: "Deno",
  bun: "Bun",
  workerd: "Cloudflare-Workers",
  node: "Node.js"
};
var getRuntimeKey = () => {
  const global = globalThis;
  const userAgentSupported = typeof navigator !== "undefined" && typeof navigator.userAgent === "string";
  if (userAgentSupported) {
    for (const [runtimeKey, userAgent] of Object.entries(knownUserAgents)) {
      if (checkUserAgentEquals(userAgent)) {
        return runtimeKey;
      }
    }
  }
  if (typeof global?.EdgeRuntime === "string") {
    return "edge-light";
  }
  if (global?.fastly !== void 0) {
    return "fastly";
  }
  if (global?.process?.release?.name === "node") {
    return "node";
  }
  return "other";
};
var checkUserAgentEquals = (platform) => {
  const userAgent = navigator.userAgent;
  return userAgent.startsWith(platform);
};

// src/utils/url.ts
var splitPath = (path) => {
  const paths = path.split("/");
  if (paths[0] === "") {
    paths.shift();
  }
  return paths;
};
var splitRoutingPath = (routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
};
var extractGroupsFromPath = (path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match, index) => {
    const mark = `@${index}`;
    groups.push([mark, match]);
    return mark;
  });
  return { groups, path };
};
var replaceGroupMarks = (paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--) {
      if (paths[j].includes(mark)) {
        paths[j] = paths[j].replace(mark, groups[i][1]);
        break;
      }
    }
  }
  return paths;
};
var patternCache = {};
var getPattern = (label, next) => {
  if (label === "*") {
    return "*";
  }
  const match = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match[2]) {
        patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [cacheKey, match[1], new RegExp(`^${match[2]}(?=/${next})`)] : [label, match[1], new RegExp(`^${match[2]}$`)];
      } else {
        patternCache[cacheKey] = [label, match[1], true];
      }
    }
    return patternCache[cacheKey];
  }
  return null;
};
var tryDecode = (str, decoder) => {
  try {
    return decoder(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match) => {
      try {
        return decoder(match);
      } catch {
        return match;
      }
    });
  }
};
var tryDecodeURI = (str) => tryDecode(str, decodeURI);
var getPath = (request) => {
  const url = request.url;
  const start = url.indexOf(
    "/",
    url.charCodeAt(9) === 58 ? 13 : 8
  );
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const path = url.slice(start, queryIndex === -1 ? void 0 : queryIndex);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63) {
      break;
    }
  }
  return url.slice(start, i);
};
var getPathNoStrict = (request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
};
var mergePath = (base, sub, ...rest) => {
  if (rest.length) {
    sub = mergePath(sub, ...rest);
  }
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
};
var checkOptionalParameter = (path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) {
    return null;
  }
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) {
      basePath += "/" + segment;
    } else if (/\:/.test(segment)) {
      if (/\?/.test(segment)) {
        if (results.length === 0 && basePath === "") {
          results.push("/");
        } else {
          results.push(basePath);
        }
        const optionalSegment = segment.replace("?", "");
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else {
        basePath += "/" + segment;
      }
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
};
var _decodeURI = (value) => {
  if (!/[%+]/.test(value)) {
    return value;
  }
  if (value.indexOf("+") !== -1) {
    value = value.replace(/\+/g, " ");
  }
  return value.indexOf("%") !== -1 ? tryDecode(value, decodeURIComponent_) : value;
};
var _getQueryParam = (url, key, multiple) => {
  let encoded;
  if (!multiple && key && !/[%+]/.test(key)) {
    let keyIndex2 = url.indexOf(`?${key}`, 8);
    if (keyIndex2 === -1) {
      keyIndex2 = url.indexOf(`&${key}`, 8);
    }
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) {
        return "";
      }
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) {
      return void 0;
    }
  }
  const results = {};
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) {
      valueIndex = -1;
    }
    let name = url.slice(
      keyIndex + 1,
      valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex
    );
    if (encoded) {
      name = _decodeURI(name);
    }
    keyIndex = nextKeyIndex;
    if (name === "") {
      continue;
    }
    let value;
    if (valueIndex === -1) {
      value = "";
    } else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) {
        value = _decodeURI(value);
      }
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) {
        results[name] = [];
      }
      results[name].push(value);
    } else {
      results[name] ??= value;
    }
  }
  return key ? results[key] : results;
};
var getQueryParam = _getQueryParam;
var getQueryParams = (url, key) => {
  return _getQueryParam(url, key, true);
};
var decodeURIComponent_ = decodeURIComponent;

// src/utils/cookie.ts
var validCookieNameRegEx = /^[\w!#$%&'*.^`|~+-]+$/;
var validCookieValueRegEx = /^[ !#-:<-[\]-~]*$/;
var parse = (cookie, name) => {
  if (cookie.indexOf(name) === -1) {
    return {};
  }
  const pairs = cookie.trim().split(";");
  const parsedCookie = {};
  for (let pairStr of pairs) {
    pairStr = pairStr.trim();
    const valueStartPos = pairStr.indexOf("=");
    if (valueStartPos === -1) {
      continue;
    }
    const cookieName = pairStr.substring(0, valueStartPos).trim();
    if (name !== cookieName || !validCookieNameRegEx.test(cookieName)) {
      continue;
    }
    let cookieValue = pairStr.substring(valueStartPos + 1).trim();
    if (cookieValue.startsWith('"') && cookieValue.endsWith('"')) {
      cookieValue = cookieValue.slice(1, -1);
    }
    if (validCookieValueRegEx.test(cookieValue)) {
      parsedCookie[cookieName] = cookieValue.indexOf("%") !== -1 ? tryDecode(cookieValue, decodeURIComponent_) : cookieValue;
      {
        break;
      }
    }
  }
  return parsedCookie;
};
var _serialize = (name, value, opt = {}) => {
  let cookie = `${name}=${value}`;
  if (name.startsWith("__Secure-") && !opt.secure) {
    throw new Error("__Secure- Cookie must have Secure attributes");
  }
  if (name.startsWith("__Host-")) {
    if (!opt.secure) {
      throw new Error("__Host- Cookie must have Secure attributes");
    }
    if (opt.path !== "/") {
      throw new Error('__Host- Cookie must have Path attributes with "/"');
    }
    if (opt.domain) {
      throw new Error("__Host- Cookie must not have Domain attributes");
    }
  }
  if (opt && typeof opt.maxAge === "number" && opt.maxAge >= 0) {
    if (opt.maxAge > 3456e4) {
      throw new Error(
        "Cookies Max-Age SHOULD NOT be greater than 400 days (34560000 seconds) in duration."
      );
    }
    cookie += `; Max-Age=${opt.maxAge | 0}`;
  }
  if (opt.domain && opt.prefix !== "host") {
    cookie += `; Domain=${opt.domain}`;
  }
  if (opt.path) {
    cookie += `; Path=${opt.path}`;
  }
  if (opt.expires) {
    if (opt.expires.getTime() - Date.now() > 3456e7) {
      throw new Error(
        "Cookies Expires SHOULD NOT be greater than 400 days (34560000 seconds) in the future."
      );
    }
    cookie += `; Expires=${opt.expires.toUTCString()}`;
  }
  if (opt.httpOnly) {
    cookie += "; HttpOnly";
  }
  if (opt.secure) {
    cookie += "; Secure";
  }
  if (opt.sameSite) {
    cookie += `; SameSite=${opt.sameSite.charAt(0).toUpperCase() + opt.sameSite.slice(1)}`;
  }
  if (opt.priority) {
    cookie += `; Priority=${opt.priority}`;
  }
  if (opt.partitioned) {
    if (!opt.secure) {
      throw new Error("Partitioned Cookie must have Secure attributes");
    }
    cookie += "; Partitioned";
  }
  return cookie;
};
var serialize = (name, value, opt) => {
  value = encodeURIComponent(value);
  return _serialize(name, value, opt);
};

// src/helper/cookie/index.ts
var getCookie = (c, key, prefix) => {
  const cookie = c.req.raw.headers.get("Cookie");
  {
    if (!cookie) {
      return void 0;
    }
    let finalKey = key;
    const obj2 = parse(cookie, finalKey);
    return obj2[finalKey];
  }
};
var setCookie = (c, name, value, opt) => {
  let cookie;
  if (opt?.prefix === "secure") {
    cookie = serialize("__Secure-" + name, value, { path: "/", ...opt, secure: true });
  } else if (opt?.prefix === "host") {
    cookie = serialize("__Host-" + name, value, {
      ...opt,
      path: "/",
      secure: true,
      domain: void 0
    });
  } else {
    cookie = serialize(name, value, { path: "/", ...opt });
  }
  c.header("Set-Cookie", cookie, { append: true });
};

// src/http-exception.ts
var HTTPException = class extends Error {
  res;
  status;
  constructor(status = 500, options) {
    super(options?.message, { cause: options?.cause });
    this.res = options?.res;
    this.status = status;
  }
  getResponse() {
    if (this.res) {
      const newResponse = new Response(this.res.body, {
        status: this.status,
        headers: this.res.headers
      });
      return newResponse;
    }
    return new Response(this.message, {
      status: this.status
    });
  }
};

// src/providers/google/googleAuth.ts

// src/utils/getRandomState.ts
var rand = () => {
  return Math.random().toString(36).substr(2);
};
function getRandomState() {
  return `${rand()}-${rand()}-${rand()}`;
}

// src/utils/objectToQuery.ts
function toQueryParams(params) {
  const elements = Object.keys(params);
  elements.forEach((element) => {
    if (params[element] === void 0) {
      delete params[element];
    }
  });
  return new URLSearchParams(params).toString();
}

// src/providers/google/authFlow.ts
var AuthFlow = class {
  client_id;
  client_secret;
  redirect_uri;
  code;
  token;
  scope;
  state;
  login_hint;
  prompt;
  user;
  granted_scopes;
  access_type;
  constructor({
    client_id,
    client_secret,
    redirect_uri,
    login_hint,
    prompt,
    scope,
    state,
    code,
    token,
    access_type
  }) {
    this.client_id = client_id;
    this.client_secret = client_secret;
    this.redirect_uri = redirect_uri;
    this.login_hint = login_hint;
    this.prompt = prompt;
    this.scope = scope;
    this.state = state;
    this.code = code;
    this.token = token;
    this.user = void 0;
    this.granted_scopes = void 0;
    this.access_type = access_type;
    if (this.client_id === void 0 || this.client_secret === void 0 || this.scope === void 0) {
      throw new HTTPException(400, {
        message: "Required parameters were not found. Please provide them to proceed."
      });
    }
  }
  redirect() {
    const parsedOptions = toQueryParams({
      response_type: "code",
      redirect_uri: this.redirect_uri,
      client_id: this.client_id,
      include_granted_scopes: true,
      scope: this.scope.join(" "),
      state: this.state,
      prompt: this.prompt,
      login_hint: this.login_hint,
      access_type: this.access_type
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${parsedOptions}`;
  }
  async getTokenFromCode() {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        clientId: this.client_id,
        clientSecret: this.client_secret,
        redirect_uri: this.redirect_uri,
        code: this.code,
        grant_type: "authorization_code"
      })
    }).then((res) => res.json());
    if ("error" in response) {
      throw new HTTPException(400, { message: response.error_description });
    }
    if ("access_token" in response) {
      this.token = {
        token: response.access_token,
        expires_in: response.expires_in
      };
      this.granted_scopes = response.scope.split(" ");
    }
  }
  async getUserData() {
    await this.getTokenFromCode();
    const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: {
        authorization: `Bearer ${this.token?.token}`
      }
    }).then((res) => res.json());
    if ("error" in response) {
      throw new HTTPException(400, { message: response.error?.message });
    }
    if ("id" in response) {
      this.user = response;
    }
  }
};

// src/providers/google/googleAuth.ts
function googleAuth(options) {
  return async (c, next) => {
    const newState = options.state || getRandomState();
    const auth = new AuthFlow({
      client_id: options.client_id || env(c).GOOGLE_ID,
      client_secret: options.client_secret || env(c).GOOGLE_SECRET,
      redirect_uri: options.redirect_uri || c.req.url.split("?")[0],
      login_hint: options.login_hint,
      prompt: options.prompt,
      access_type: options.access_type,
      scope: options.scope,
      state: newState,
      code: c.req.query("code"),
      token: {
        token: c.req.query("access_token"),
        expires_in: Number(c.req.query("expires-in"))
      }
    });
    if (!auth.code) {
      setCookie(c, "state", newState, {
        maxAge: 60 * 10,
        httpOnly: true,
        path: "/"
        // secure: true,
      });
      return c.redirect(auth.redirect());
    }
    if (c.req.url.includes("?")) {
      const storedState = getCookie(c, "state");
      if (c.req.query("state") !== storedState) {
        throw new HTTPException(401);
      }
    }
    await auth.getUserData();
    c.set("token", auth.token);
    c.set("user-google", auth.user);
    c.set("granted-scopes", auth.granted_scopes);
    await next();
  };
}

const googleAuthMiddleware = googleAuth({
  client_id: process.env.GOOGLE_CLIENT_ID,
  client_secret: process.env.GOOGLE_CLIENT_SECRET,
  scope: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/calendar"
  ],
  redirect_uri: process.env.GOOGLE_REDIRECT_URI,
  access_type: "offline",
  prompt: "consent",
  state: "agent-auth"
  // CSRF protection
});

const mastra = new Mastra({
  logger,
  server: {
    port: 3e3,
    // Defaults to 4111
    timeout: 1e4,
    // Defaults to 30000 (30s)
    cors: {
      origin: ["*"],
      // Allow specific origins or '*' for all
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      credentials: false
    },
    middleware: [
      // Add a global request logger
      async (c, next) => {
        logger.debug(`${c.req.method} ${c.req.url}`);
        await next();
      }
    ],
    apiRoutes: [registerApiRoute("/auth/google", {
      method: "GET",
      middleware: [googleAuthMiddleware],
      handler: async (c) => {
        const token = c.get("token");
        const grantedScopes = c.get("granted-scopes");
        const user = c.get("user-google");
        return c.json({
          token,
          grantedScopes,
          user
        });
      }
    })]
  },
  agents: {
    weatherAgentWithWorkflow,
    webSearchAgent
  },
  workflows: {
    weatherWorkflowWithSuspend
  }
});

export { HTTPException as H, getQueryParams as a, getPath as b, getPathNoStrict as c, decodeURIComponent_ as d, checkOptionalParameter as e, getPattern as f, getQueryParam as g, splitPath as h, mastra as i, startWeatherTool as j, toolRegistry as k, localTools as l, mergePath as m, resumeWeatherTool as r, splitRoutingPath as s, tryDecode as t };
//# sourceMappingURL=index2.mjs.map
