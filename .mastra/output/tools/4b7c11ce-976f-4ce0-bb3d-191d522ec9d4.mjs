import { z } from 'zod';
import { l as logger } from '../logger.mjs';
import 'winston';

function extractZodSchema(zodSchema) {
  try {
    if (zodSchema instanceof z.ZodObject) {
      const shape = zodSchema.shape;
      const properties = {};
      const required = [];
      for (const [key, value] of Object.entries(shape)) {
        const zodType = value;
        properties[key] = extractZodTypeInfo(zodType);
        if (!zodType.isOptional()) {
          required.push(key);
        }
      }
      return {
        type: "object",
        properties,
        required: required.length > 0 ? required : void 0
      };
    }
    return extractZodTypeInfo(zodSchema);
  } catch (error) {
    logger.warn("Failed to extract Zod schema:", error);
    return { type: "unknown", description: "Schema extraction failed" };
  }
}
function extractZodTypeInfo(zodType) {
  try {
    const description = zodType.description;
    if (zodType instanceof z.ZodString) {
      return { type: "string", description };
    }
    if (zodType instanceof z.ZodNumber) {
      return { type: "number", description };
    }
    if (zodType instanceof z.ZodBoolean) {
      return { type: "boolean", description };
    }
    if (zodType instanceof z.ZodArray) {
      return {
        type: "array",
        items: extractZodTypeInfo(zodType.element),
        description
      };
    }
    if (zodType instanceof z.ZodEnum) {
      return {
        type: "string",
        enum: zodType.options,
        description
      };
    }
    if (zodType instanceof z.ZodOptional) {
      return extractZodTypeInfo(zodType.unwrap());
    }
    if (zodType instanceof z.ZodObject) {
      return extractZodSchema(zodType);
    }
    return { type: "any", description };
  } catch (error) {
    return {
      type: "unknown",
      description: "Type extraction failed"
    };
  }
}
function logToolSchemaForLLM(toolName, description, parameters, server) {
  try {
    const schemaInfo = {
      name: toolName,
      description,
      parameters: extractZodSchema(parameters),
      ...server && { server }
    };
    logger.info(`\u{1F527} Tool Schema Registered for LLM: ${toolName}`, {
      toolSchema: schemaInfo,
      readableFormat: {
        name: toolName,
        description,
        server: server || "unknown",
        parameterSchema: JSON.stringify(schemaInfo.parameters, null, 2)
      }
    });
  } catch (error) {
    logger.error(`Failed to log schema for tool ${toolName}:`, error);
  }
}
function logAgentToolSchemasForLLM(agentName, tools, serverName) {
  const toolSchemas = [];
  for (const [toolName, tool] of Object.entries(tools)) {
    try {
      const schemaInfo = {
        name: toolName,
        description: tool.description,
        parameters: extractZodSchema(tool.parameters),
        ...serverName && { server: serverName }
      };
      toolSchemas.push(schemaInfo);
    } catch (error) {
      logger.warn(`Failed to extract schema for tool ${toolName}:`, error);
    }
  }
  logger.info(`\u{1F916} Agent Tool Schemas Registered for LLM: ${agentName}`, {
    agentName,
    serverName: serverName || "multiple",
    toolCount: toolSchemas.length,
    toolSchemas,
    summary: {
      agentName,
      availableTools: toolSchemas.map((t) => ({
        name: t.name,
        description: t.description,
        hasParameters: Object.keys(t.parameters.properties || {}).length > 0,
        requiredFields: t.parameters.required || []
      }))
    }
  });
}
function logCompleteToolRegistryForLLM(toolsByServer, totalToolCount) {
  const registrySummary = {
    totalTools: totalToolCount,
    serverCount: Object.keys(toolsByServer).length,
    toolsByServer: {}
  };
  for (const [serverName, tools] of Object.entries(toolsByServer)) {
    const serverTools = [];
    for (const [toolName, tool] of Object.entries(tools)) {
      try {
        serverTools.push({
          name: toolName,
          description: tool.description,
          parameters: extractZodSchema(tool.parameters)
        });
      } catch (error) {
        logger.warn(
          `Failed to process tool ${toolName} from ${serverName}:`,
          error
        );
      }
    }
    registrySummary.toolsByServer[serverName] = {
      toolCount: serverTools.length,
      tools: serverTools
    };
  }
  logger.info("\u{1F31F} Complete Tool Registry for LLM Ready", {
    registrySummary,
    llmContext: {
      message: "All available tools have been registered and are ready for LLM consumption",
      totalAvailableTools: totalToolCount,
      serversWithTools: Object.keys(toolsByServer),
      toolCategories: Object.entries(registrySummary.toolsByServer).map(
        ([server, info]) => ({
          server,
          toolCount: info.toolCount,
          capabilities: info.tools.map((t) => t.description).slice(0, 3)
          // Sample capabilities
        })
      )
    }
  });
}

export { extractZodSchema, logAgentToolSchemasForLLM, logCompleteToolRegistryForLLM, logToolSchemaForLLM };
//# sourceMappingURL=4b7c11ce-976f-4ce0-bb3d-191d522ec9d4.mjs.map
