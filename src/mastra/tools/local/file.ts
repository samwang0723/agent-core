// src/tools/propose-patch.ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { generateText, LanguageModel } from 'ai';
import { createModelByKey } from '../../models/model.service';

export const fileEditing = createTool({
  id: 'file-editing',
  description:
    'Return JSON {patch,newContent,stats} for editing a single file.',
  inputSchema: z.object({
    path: z.string(),
    language: z.string().optional(),
    original: z.string(),
    instruction: z.string().min(1),
  }),
  outputSchema: z.object({
    path: z.string(),
    newContent: z.string(),
  }),
  execute: async ({ context }) => {
    const { path, original, instruction, language } = context;

    const { text } = await generateText({
      model: createModelByKey('claude-4-sonnet') as LanguageModel,
      system: [
        'You are a precise code transformer.',
        'Return ONLY the FULL updated file in one fenced code block.',
        'Keep unrelated changes minimal.',
      ].join('\n'),
      prompt: [
        `Edit the ${language ?? 'file'} at path: ${path}`,
        'Instruction:',
        instruction,
        '',
        '----- ORIGINAL -----',
        '```',
        original,
        '```',
      ].join('\n'),
    });

    const m = text.match(/```[\w.+-]*\n([\s\S]*?)```/);
    const newContent = m ? m[1] : text;

    return { path, newContent }; // Also the formal tool result (typed)
  },
});
