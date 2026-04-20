/**
 * Asset Assistant API — POST /api/cli-assets/assistant
 *
 * Generates prompts for creating new assets or modifying existing ones.
 * Prompts reference files by path — the terminal LLM reads them.
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getSlycodeRoot } from '@/lib/paths';
import type { ProviderId, AssetType } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mode, provider, assetType, assetName, description, changes } = body as {
      mode: 'create' | 'modify';
      provider: ProviderId;
      assetType: AssetType;
      assetName?: string;
      description?: string;
      changes?: string;
    };

    if (!mode || !provider || !assetType) {
      return NextResponse.json(
        { error: 'mode, provider, and assetType are required' },
        { status: 400 },
      );
    }

    if (mode === 'create' && (!assetName || !description)) {
      return NextResponse.json(
        { error: 'assetName and description are required for create mode' },
        { status: 400 },
      );
    }

    if (mode === 'modify' && !assetName) {
      return NextResponse.json(
        { error: 'assetName is required for modify mode' },
        { status: 400 },
      );
    }

    const root = getSlycodeRoot();

    // Build output path (flat canonical store)
    let outputPath: string;
    if (assetType === 'mcp') {
      outputPath = path.join(root, `store/mcp/${assetName}.json`);
    } else {
      const typeDir = assetType === 'skill' ? 'skills' : 'agents';
      const outputRelative = assetType === 'skill'
        ? `store/${typeDir}/${assetName}/SKILL.md`
        : `store/${typeDir}/${assetName}.md`;
      outputPath = path.join(root, outputRelative);
    }

    const refPath = path.join(root, 'documentation', 'reference', 'ai_cli_providers.md');

    if (mode === 'modify') {
      // Verify the file exists
      if (!fs.existsSync(outputPath)) {
        if (assetType === 'mcp') {
          return NextResponse.json(
            { error: `Could not find MCP config '${assetName}' at ${outputPath}` },
            { status: 404 },
          );
        }
        if (assetType !== 'skill') {
          return NextResponse.json(
            { error: `Could not find asset '${assetName}' in store at ${outputPath}` },
            { status: 404 },
          );
        }
      }
    }

    let prompt: string;
    if (assetType === 'mcp') {
      prompt = mode === 'create'
        ? buildMcpCreatePrompt(assetName!, description!, outputPath)
        : buildMcpModifyPrompt(assetName!, changes || '', outputPath);
    } else {
      prompt = mode === 'create'
        ? buildCreatePrompt(provider, assetType, assetName!, description!, outputPath, refPath)
        : buildModifyPrompt(provider, assetType, assetName!, changes || '', outputPath, refPath);
    }

    return NextResponse.json({ prompt, outputPath });
  } catch (error) {
    console.error('Asset assistant failed:', error);
    return NextResponse.json(
      { error: 'Failed to generate assistant prompt', details: String(error) },
      { status: 500 },
    );
  }
}

function buildCreatePrompt(
  provider: ProviderId,
  assetType: AssetType,
  assetName: string,
  description: string,
  outputPath: string,
  refPath: string,
): string {
  const providerNames: Record<ProviderId, string> = {
    claude: 'Claude Code',
    agents: 'Agents (Universal)',
    codex: 'Codex CLI',
    gemini: 'Gemini CLI',
  };

  const typeGuidance: Record<string, string> = {
    skill: 'Skills are SKILL.md files that give the AI specialized knowledge or workflows. They can be invoked via slash commands. They describe when/how to use the skill and can include a references/ subdirectory for supporting files. The skill directory structure is: skillname/SKILL.md and optionally skillname/references/*.md.',
    agent: 'Agents are custom agent definitions that configure specialized behavior, purpose, capabilities, and tool usage.',
  };

  return `Create a new ${providerNames[provider]} ${assetType} called "${assetName}".

**Format reference:** \`${refPath}\`
**Output file:** \`${outputPath}\`

## What it should do
${description}

## ${assetType.charAt(0).toUpperCase() + assetType.slice(1)} format
${typeGuidance[assetType] || ''}

Read the format reference for ${providerNames[provider]}-specific conventions, then create the ${assetType}.

## Required frontmatter

\`\`\`yaml
---
name: ${assetName}
version: 1.0.0
updated: <today's date, YYYY-MM-DD>
description: "<concise one-line summary>"
---
\`\`\`

All four fields are mandatory. The description should summarize the ${assetType}'s purpose in one line.
${provider === 'agents' ? `
## Provider-Neutral Language

Since this asset targets the universal .agents/ directory (used by both Codex CLI and Gemini CLI), you MUST write all text in provider-neutral language:
- Do NOT mention specific tools like "Claude Code", "Codex CLI", or "Gemini CLI"
- Use generic terms like "the AI assistant" or "the agent" instead
- The content should work identically across any AI coding tool that reads .agents/
` : ''}
Write the complete file to \`${outputPath}\`.`;
}

function buildModifyPrompt(
  provider: ProviderId,
  assetType: AssetType,
  assetName: string,
  changes: string,
  outputPath: string,
  refPath: string,
): string {
  const providerNames: Record<ProviderId, string> = {
    claude: 'Claude Code',
    agents: 'Agents (Universal)',
    codex: 'Codex CLI',
    gemini: 'Gemini CLI',
  };

  const changesSection = changes
    ? changes
    : 'Review and improve this asset. Fix any issues, improve clarity, and ensure it follows best practices.';

  return `Modify the ${providerNames[provider]} ${assetType} "${assetName}".

**File to modify:** \`${outputPath}\`
**Format reference:** \`${refPath}\`

Read the file, then apply these changes:

${changesSection}

## Frontmatter rules
- Bump the \`version\` (patch increment, e.g. 1.0.0 → 1.0.1)
- Update \`updated\` to today's date
- Keep all other frontmatter fields intact (\`name\`, \`description\`)
- If any required field is missing, add it

Write the updated file back to \`${outputPath}\`.`;
}

function buildMcpCreatePrompt(
  assetName: string,
  description: string,
  outputPath: string,
): string {
  return `Create an MCP (Model Context Protocol) server configuration called "${assetName}".

**Output file:** \`${outputPath}\`

## What this MCP server should do
${description}

## Research steps

1. Research the MCP server package described above — find the correct npm package name, command, and required arguments
2. Check if there are any required environment variables or setup steps
3. Determine whether this is a stdio MCP (runs locally via command) or HTTP MCP (connects to a URL)

## Store JSON format

There are two transport types. Use the one that matches the MCP server:

### Stdio MCP (runs a local process)
\`\`\`json
{
  "name": "${assetName}",
  "command": "<executable, e.g. npx, node, python>",
  "args": ["<arguments to launch the MCP server>"],
  "env": {
    "API_KEY": "\${API_KEY}"
  },
  "description": "<concise one-line description>",
  "version": "1.0.0",
  "updated": "<today's date, YYYY-MM-DD>"
}
\`\`\`

### HTTP MCP (connects to a remote URL)
\`\`\`json
{
  "name": "${assetName}",
  "url": "https://<mcp-server-url>",
  "headers": {
    "Authorization": "Bearer \${API_KEY}"
  },
  "description": "<concise one-line description>",
  "version": "1.0.0",
  "updated": "<today's date, YYYY-MM-DD>"
}
\`\`\`

## Key points
- \`name\` must be \`${assetName}\`
- **Stdio**: \`command\` is the executable (usually \`npx\`), \`args\` is an array, \`env\` holds environment variables with \`\${PLACEHOLDER}\` values
- **HTTP**: \`url\` is the MCP server endpoint, \`headers\` is optional (for auth tokens etc.)
- Do NOT include both \`command\` and \`url\` — pick one transport type
- \`description\`, \`version\`, and \`updated\` are required metadata fields
- The file must be valid JSON

Write the config to \`${outputPath}\`.`;
}

function buildMcpModifyPrompt(
  assetName: string,
  changes: string,
  outputPath: string,
): string {
  const changesSection = changes
    ? changes
    : 'Review and improve this MCP configuration. Verify the package exists, update to latest version, and ensure all fields are correct.';

  return `Modify the MCP server configuration "${assetName}".

**File to modify:** \`${outputPath}\`

Read the file, then apply these changes:

${changesSection}

## Rules
- Keep the JSON structure intact
- Update \`version\` (patch increment, e.g. 1.0.0 → 1.0.1)
- Update \`updated\` to today's date
- Keep \`name\` as \`${assetName}\`
- The file must be valid JSON

Write the updated file back to \`${outputPath}\`.`;
}
