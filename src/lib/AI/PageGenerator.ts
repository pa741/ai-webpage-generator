import { trackAIInteraction, trackError, trackWebsiteGeneration } from '$lib/analytics';
import { generateText, jsonSchema, stepCountIs, tool } from 'ai';
import { Runware } from '@runware/sdk-js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { RUNWARE_API_KEY } from '$env/static/private';
import { env } from '$env/dynamic/private';
import { PUBLIC_FIREBASE_PROJECT_ID } from '$env/static/public';
import { logger } from '$lib/logger';
import { recordLlmCall, recordToolCall } from '$lib/metrics';

import pageDesignerPrompt from '../../../prompts/page_designer.md?raw';
import htmlGeneratorPrompt from '../../../prompts/html_generator.md?raw';
import actionRunnerPrompt from '../../../prompts/action_runner.md?raw';
import imageDescriptionPrompt from '../../../prompts/image_description.md?raw';
import imageGenerationNegativePrompt from '../../../prompts/image_generation.md?raw';

function requireEnv(name: string): string {
    const value = env[name];
    if (!value || !value.trim()) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value.trim();
}

const PAGE_DESIGNER_MODEL = () => requireEnv('PAGE_DESIGNER_MODEL');
const HTML_GENERATOR_MODEL = () => requireEnv('HTML_GENERATOR_MODEL');
const ACTION_RUNNER_MODEL = () => requireEnv('ACTION_RUNNER_MODEL');
const IMAGE_DESCRIPTION_MODEL = () => requireEnv('IMAGE_DESCRIPTION_MODEL');
const IMAGE_GENERATION_MODEL = () => requireEnv('IMAGE_GENERATION_MODEL');
import { resolveLanguageModel, resolveProviderName } from './model-provider';
import { loadUserPreferences, formatPreferencesForPrompt, type UserPreference } from './user-preferences';
import { cerebras } from '@ai-sdk/cerebras';

const log = logger.child('PageGenerator');

const runware = new Runware({ apiKey: RUNWARE_API_KEY });

const MCP_REGION = 'europe-southwest1';
const MAX_TOOL_LOOP_ITERATIONS = 10;

const COMPONENT_TOOLS = new Set([
    'GetAllComponents',
    'GetComponents',
    'CreateComponent',
    'UpdateComponent'
]);

interface PageSection {
    component?: string;
    props?: Record<string, unknown>;
    content?: string;
    children?: PageSection[];
}

interface PageSpec {
    title?: string;
    description?: string;
    sections?: PageSection[];
    [key: string]: unknown;
}

function resolveMcpUrl(request: Request): URL | null {
    const configuredUrl = env.MCP_ENDPOINT?.trim();
    if (configuredUrl) {
        try {
            return new URL(configuredUrl);
        } catch {
            log.warn('mcp.endpoint_invalid', { configuredUrl });
        }
    }

    if (PUBLIC_FIREBASE_PROJECT_ID) {
        return new URL(`https://${MCP_REGION}-${PUBLIC_FIREBASE_PROJECT_ID}.cloudfunctions.net/mcp`);
    }

    try {
        const baseUrl = new URL(request.url);
        return new URL('/mcp', `${baseUrl.protocol}//${baseUrl.host}`);
    } catch {
        return null;
    }
}

async function withMcpClient<T>(
    request: Request,
    action: (client: Client) => Promise<T>,
    idToken?: string
): Promise<T | null> {
    const mcpUrl = resolveMcpUrl(request);
    if (!mcpUrl) {
        log.error('mcp.url_unresolved');
        return null;
    }

    const authorizationHeader = idToken
        ? `Bearer ${idToken}`
        : request.headers.get('authorization');
    const transport = new StreamableHTTPClientTransport(mcpUrl, {
        requestInit: authorizationHeader
            ? { headers: { Authorization: authorizationHeader } }
            : undefined
    });
    const mcp = new Client({ name: 'ai-webpage-generator', version: '1.0.0' });

    const stop = log.time('mcp.session', { mcpUrl: mcpUrl.toString(), authenticated: Boolean(authorizationHeader) });
    try {
        await mcp.connect(transport);
        const result = await action(mcp);
        stop({ ok: true });
        return result;
    } catch (error) {
        stop({ ok: false, error });
        log.error('mcp.session_failed', { error });
        return null;
    } finally {
        try {
            await mcp.close();
        } catch {
            // Ignore close errors from short-lived MCP requests.
        }
    }
}

function parseToolJson(content: unknown): unknown {
    if (!Array.isArray(content)) {
        return null;
    }

    const texts = content
        .filter((item): item is { type?: string; text?: string } => Boolean(item && typeof item === 'object'))
        .filter((item) => item.type === 'text' && typeof item.text === 'string')
        .map((item) => item.text as string)
        .join('\n')
        .trim();

    if (!texts) {
        return null;
    }

    try {
        return JSON.parse(texts);
    } catch {
        return texts;
    }
}

interface ToolLoopResult {
    finalText: string;
    toolInvocations: Array<{ name: string; args: Record<string, unknown>; result: unknown }>;
}

interface McpToolDescriptor {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    annotations?: { readOnlyHint?: boolean } & Record<string, unknown>;
}

async function runMcpToolLoop(input: {
    request: Request;
    model: string;
    systemPrompt: string;
    userPrompt: string;
    allowTool?: (descriptor: McpToolDescriptor) => boolean;
    scope: string;
    idToken?: string;
}): Promise<ToolLoopResult> {
    const result: ToolLoopResult = { finalText: '', toolInvocations: [] };
    const loopLog = log.child(`loop.${input.scope}`, {
        model: input.model,
        prompt_chars: input.userPrompt.length,
        system_chars: input.systemPrompt.length
    });

    const outcome = await withMcpClient(input.request, async (mcp) => {
        const listStop = loopLog.time('list_tools');
        const listed = await mcp.listTools();
        const allowed = ((listed?.tools ?? []) as McpToolDescriptor[])
            .filter((t) => !input.allowTool || input.allowTool(t));
        listStop({ tool_count: allowed.length });

        const domainInstructions = (mcp.getInstructions?.() ?? '').trim();
        const systemPrompt = domainInstructions
            ? `${input.systemPrompt}\n\nDomain context:\n${domainInstructions}`
            : input.systemPrompt;

        const tools: Record<string, unknown> = {};
        for (const descriptor of allowed) {
            const schema = (descriptor.inputSchema && typeof descriptor.inputSchema === 'object')
                ? descriptor.inputSchema
                : { type: 'object', properties: {} };

            tools[descriptor.name] = tool({
                description: descriptor.description ?? '',
                inputSchema: jsonSchema(schema),
                execute: async (rawArgs) => {
                    const args = (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs))
                        ? rawArgs as Record<string, unknown>
                        : {};
                    const toolStartedAt = new Date();
                    const toolStop = loopLog.time('tool_call', {
                        tool: descriptor.name,
                        args: JSON.stringify(args)
                    });
                    try {
                        const response = await mcp.callTool({ name: descriptor.name, arguments: args });
                        const parsed = parseToolJson(response.content);
                        result.toolInvocations.push({ name: descriptor.name, args, result: parsed });
                        const toolDuration = toolStop({
                            ok: true,
                            result_chars: typeof parsed === 'string' ? parsed.length : JSON.stringify(parsed ?? null).length
                        });
                        recordToolCall({ toolName: descriptor.name, durationMs: toolDuration, ok: true, startedAt: toolStartedAt });
                        return parsed ?? null;
                    } catch (error) {
                        const message = error instanceof Error ? error.message : 'Unknown tool error';
                        result.toolInvocations.push({ name: descriptor.name, args, result: { error: message } });
                        const toolDuration = toolStop({ ok: false, error });
                        recordToolCall({ toolName: descriptor.name, durationMs: toolDuration, ok: false, startedAt: toolStartedAt });
                        loopLog.warn('tool_call_failed', { tool: descriptor.name, error });
                        return { error: message };
                    }
                }
            });
        }

        const llmStartedAt = new Date();
        const llmStop = loopLog.time('llm_call');
        try {
            const generation = await generateText({
                model: resolveLanguageModel(input.model),
                system: systemPrompt,
                prompt: input.userPrompt,
                tools: tools as Parameters<typeof generateText>[0]['tools'],
                stopWhen: stepCountIs(MAX_TOOL_LOOP_ITERATIONS),
                onStepFinish(step) {
                    loopLog.debug('step_finished', {
                        step_number: step.stepNumber,
                        tool_calls: step.toolCalls.length,
                        finish_reason: step.finishReason
                    });
                }
            });
            const llmDuration = llmStop({
                ok: true,
                steps: generation.steps.length,
                tool_calls_total: result.toolInvocations.length,
                finish_reason: generation.finishReason,
                total_tokens: generation.totalUsage.totalTokens
            });
            recordLlmCall({
                phase: `designer.${input.scope}`,
                model: input.model,
                durationMs: llmDuration,
                inputTokens: generation.totalUsage.inputTokens,
                outputTokens: generation.totalUsage.outputTokens,
                totalTokens: generation.totalUsage.totalTokens,
                finishReason: generation.finishReason,
                toolCallsTotal: result.toolInvocations.length,
                startedAt: llmStartedAt,
            });

            result.finalText = generation.text ?? '';
            loopLog.info('loop_complete', {
                iterations: generation.steps.length,
                tool_calls_total: result.toolInvocations.length,
                final_chars: result.finalText.length
            });
            return result;
        } catch (error) {
            llmStop({ ok: false, error });
            loopLog.error('llm_call_failed', { error });
            return result;
        }
    }, input.idToken);

    return outcome ?? result;
}

export interface DesignedPage {
    pageSpec: PageSpec;
    rawDesignerOutput: string;
    usedComponentIds: string[];
}

export async function DesignPage(request: Request, route: string, idToken?: string, userId?: string): Promise<DesignedPage> {
    const pageDesignerModel = PAGE_DESIGNER_MODEL();
    const stop = log.child('design').time('design', { route, model: pageDesignerModel, authenticated: Boolean(idToken) });
    trackAIInteraction('page_designer_request', pageDesignerModel);

    const allowTool = (d: McpToolDescriptor) =>
        COMPONENT_TOOLS.has(d.name) || d.annotations?.readOnlyHint === true;

    const userPreferences = await loadUserPreferences(userId);
    const userPromptObj: Record<string, unknown> = { route };
    if (userPreferences.length) {
        userPromptObj.userPreferences = userPreferences.map((p) => p.text);
    }
    const { finalText, toolInvocations } = await runMcpToolLoop({
        request,
        model: pageDesignerModel,
        systemPrompt: pageDesignerPrompt,
        userPrompt: JSON.stringify(userPromptObj),
        allowTool,
        scope: 'designer',
        idToken
    });

    const pageSpec = parsePageSpec(finalText);
    const used = collectComponentIds(pageSpec, toolInvocations);
    const created = toolInvocations.filter((t) => t.name === 'CreateComponent').map((t) => t.args?.id);

    stop({
        section_count: Array.isArray(pageSpec.sections) ? pageSpec.sections.length : 0,
        used_component_ids: used,
        components_created: created,
        tool_calls: toolInvocations.length,
        spec_chars: finalText.length
    });

    return { pageSpec, rawDesignerOutput: finalText, usedComponentIds: used };
}

function parsePageSpec(rawText: string): PageSpec {
    const text = stripCodeFence(rawText).trim();
    if (!text) {
        return {};
    }
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as PageSpec;
        }
    } catch {
        // fall through
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
        try {
            const parsed = JSON.parse(text.slice(start, end + 1));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as PageSpec;
            }
        } catch {
            // fall through
        }
    }
    return { description: text };
}

function stripCodeFence(value: string): string {
    const trimmed = value.trim();
    if (!trimmed.startsWith('```')) {
        return trimmed;
    }
    return trimmed.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '').trim();
}

function collectComponentIds(
    spec: PageSpec,
    toolInvocations: Array<{ name: string; args: Record<string, unknown>; result: unknown }>
): string[] {
    const ids = new Set<string>();

    const visit = (section: PageSection | undefined) => {
        if (!section) return;
        if (typeof section.component === 'string' && section.component.trim()) {
            ids.add(section.component.trim());
        }
        section.children?.forEach(visit);
    };
    spec.sections?.forEach(visit);

    for (const invocation of toolInvocations) {
        if (invocation.name === 'CreateComponent' || invocation.name === 'UpdateComponent') {
            const result = invocation.result as { id?: unknown; rejected?: unknown; gsPath?: unknown } | null;
            if (result && typeof result === 'object' && (result as any).rejected === true) {
                continue;
            }

            const id = invocation.args?.id;
            if (typeof id === 'string' && id.trim()) {
                ids.add(id.trim());
            }
            if (result && typeof result === 'object' && typeof (result as any).id === 'string') {
                ids.add((result as any).id);
            }
        }
    }

    return Array.from(ids);
}

export async function RequestHtml(_request: Request, pageSpec: PageSpec, usedComponentIds: string[]): Promise<string> {
    const renderLog = log.child('render');
    const htmlGeneratorModel = HTML_GENERATOR_MODEL();
    const stop = renderLog.time('render', {
        model: htmlGeneratorModel,
        provider: resolveProviderName(htmlGeneratorModel),
        component_count: usedComponentIds.length
    });
    trackAIInteraction('website_generation_request', htmlGeneratorModel);

    const userPrompt = JSON.stringify({
        pageSpec,
        availableComponents: usedComponentIds
    });
    renderLog.info('render_input', { prompt_chars: userPrompt, pageSpec: JSON.stringify(pageSpec) });
    try {
        const llmStartedAt = new Date();
        const llmT0 = performance.now();
        const result = await generateText({
            model: resolveLanguageModel(htmlGeneratorModel),
            system: htmlGeneratorPrompt,
            prompt: userPrompt
        });
        const llmDurationMs = Math.round(performance.now() - llmT0);

        if (typeof result.text !== 'string' || !result.text.trim()) {
            trackWebsiteGeneration(JSON.stringify(pageSpec), false);
            stop({ ok: false, reason: 'empty_content' });
            return '<!-- Error generating HTML: No content returned -->';
        }

        const cleaned = result.text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        trackWebsiteGeneration(JSON.stringify(pageSpec), true);
        stop({
            ok: true,
            html_chars: cleaned.length,
            input_tokens: result.usage.inputTokens,
            output_tokens: result.usage.outputTokens,
            total_tokens: result.totalUsage.totalTokens
        });
        recordLlmCall({
            phase: 'html_generator',
            model: htmlGeneratorModel,
            durationMs: llmDurationMs,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            totalTokens: result.totalUsage.totalTokens,
            finishReason: result.finishReason,
            startedAt: llmStartedAt,
        });
        return cleaned;
    } catch (error) {
        trackWebsiteGeneration(JSON.stringify(pageSpec), false);
        stop({ ok: false, error });
        renderLog.error('render_failed', { error });
        return '<!-- Error generating HTML ' + (error instanceof Error ? error.message : error) + ' -->';
    }
}

export interface GeneratedPage {
    prompt: string;
    html: string;
    pageSpec: PageSpec;
    usedComponentIds: string[];
}

export async function GenerateHtml(request: Request, route: string, idToken?: string, userId?: string): Promise<GeneratedPage> {
    const designed = await DesignPage(request, route, idToken, userId);
    log.info('page_designed', {
        route,
        prompt_chars: designed.rawDesignerOutput,
        page_spec: JSON.stringify(designed.pageSpec),
        used_component_ids: designed.usedComponentIds
    });
    const html = await RequestHtml(request, designed.pageSpec, designed.usedComponentIds);
    return {
        prompt: designed.rawDesignerOutput,
        html,
        pageSpec: designed.pageSpec,
        usedComponentIds: designed.usedComponentIds
    };
}

export async function GenerateHomePage(request: Request, idToken?: string, userId?: string): Promise<GeneratedPage> {
    return GenerateHtml(request, '', idToken, userId);
}

async function GetImageDescriptionFromRoute(route: string): Promise<string> {
    const imageDescriptionModel = IMAGE_DESCRIPTION_MODEL();
    const stop = log.child('image').time('describe', {
        route,
        model: imageDescriptionModel,
        provider: resolveProviderName(imageDescriptionModel)
    });
    trackAIInteraction('image_description_generation_request', imageDescriptionModel);

    try {
        const result = await generateText({
            model: resolveLanguageModel(imageDescriptionModel),
            system: imageDescriptionPrompt,
            prompt: route
        });

        const description = result.text ?? '';
        stop({
            ok: true,
            description_chars: description.length,
            input_tokens: result.usage.inputTokens,
            output_tokens: result.usage.outputTokens,
            total_tokens: result.totalUsage.totalTokens
        });
        return description;
    } catch (error) {
        stop({ ok: false, error });
        log.error('image.describe_failed', { route, error });
        return '';
    }
}

export async function GenerateImageFromRoute(_request: Request, route: string): Promise<string> {
    const imageGenerationModel = IMAGE_GENERATION_MODEL();
    const imgLog = log.child('image', { route, model: imageGenerationModel });
    const stop = imgLog.time('generate');

    await runware.ensureConnection();
    const description = await GetImageDescriptionFromRoute(route);

    if (!description) {
        stop({ ok: false, reason: 'empty_description' });
        return '';
    }

    try {
        const response = await runware.requestImages({
            model: imageGenerationModel,
            positivePrompt: description,
            negativePrompt: imageGenerationNegativePrompt,
            numberResults: 1,
            CFGScale: 1,
            steps: 1,
            outputType: 'base64Data',
            outputFormat: 'PNG',
            width: 1024,
            height: 1024
        });

        if (!response || response.length === 0 || !response[0].imageBase64Data) {
            trackError('Image generation failed', `Route: ${route}, Description: ${description}`);
            stop({ ok: false, reason: 'empty_response' });
            return '';
        }
        trackAIInteraction('image_generation_request', imageGenerationModel);
        stop({ ok: true, base64_chars: response[0].imageBase64Data.length });
        return response[0].imageBase64Data;
    } catch (error) {
        trackError('Image generation failed', `Route: ${route}`);
        stop({ ok: false, error });
        imgLog.error('runware_failed', { error });
        return '';
    }
}

export async function HandleAction(request: Request, idToken?: string, userId?: string): Promise<Response> {
    const url = new URL(request.url);
    const route = url.pathname;
    const method = request.method;
    const actionLog = log.child('action', { method, route });
    const stop = actionLog.time('action');

    let bodyJson: Record<string, unknown> = {};
    let bodyText = '';
    try {
        bodyText = await request.text();
        if (bodyText.trim()) {
            const parsed = JSON.parse(bodyText);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                bodyJson = parsed as Record<string, unknown>;
            }
        }
    } catch (error) {
        actionLog.warn('body_not_json', { body_chars: bodyText.length, error });
    }

    const outputFormat = (typeof bodyJson.outputFormat === 'string' && bodyJson.outputFormat.trim())
        ? bodyJson.outputFormat
        : '{ "ok": boolean, "message": string, "data": any }';

    const authenticated = Boolean(idToken || request.headers.get('authorization'));
    const actionRunnerModel = ACTION_RUNNER_MODEL();
    trackAIInteraction('action_runner_request', actionRunnerModel);
    actionLog.info('action_received', {
        body_keys: Object.keys(bodyJson),
        output_format: outputFormat,
        authenticated
    });

    const allowTool = (d: McpToolDescriptor) => !COMPONENT_TOOLS.has(d.name);

    const userPreferences = await loadUserPreferences(userId);
    const userPromptObj: Record<string, unknown> = {
        method,
        route,
        body: bodyJson,
        rawBody: bodyJson && Object.keys(bodyJson).length > 0 ? undefined : bodyText,
        //outputFormat,
        authenticated
    };
    if (userPreferences.length) {
        userPromptObj.userPreferences = userPreferences.map((p: UserPreference) => p.text);
    }
    const userPrompt = JSON.stringify(userPromptObj);

    const { finalText, toolInvocations } = await runMcpToolLoop({
        request,
        model: actionRunnerModel,
        systemPrompt: actionRunnerPrompt,
        userPrompt,
        allowTool,
        scope: 'action',
        idToken
    });

    const json = parseActionJson(finalText, toolInvocations);
    stop({
        tools_invoked: toolInvocations.map((t) => t.name),
        last_tool: toolInvocations[toolInvocations.length - 1]?.name,
        ok: !(json && typeof json === 'object' && (json as any).ok === false)
    });

    return new Response(JSON.stringify(json), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'private, no-store',
            'X-Robots-Tag': 'noindex, nofollow'
        }
    });
}

function parseActionJson(
    rawText: string,
    toolInvocations: Array<{ name: string; args: Record<string, unknown>; result: unknown }>
): unknown {
    const text = stripCodeFence(rawText).trim();
    if (text) {
        try {
            return JSON.parse(text);
        } catch {
            const start = text.indexOf('{');
            const end = text.lastIndexOf('}');
            if (start !== -1 && end > start) {
                try {
                    return JSON.parse(text.slice(start, end + 1));
                } catch {
                    // fall through
                }
            }
        }
    }

    const lastInvocation = toolInvocations[toolInvocations.length - 1];
    return {
        ok: Boolean(lastInvocation && !(lastInvocation.result as any)?.error),
        message: rawText.trim() || (lastInvocation ? `Executed ${lastInvocation.name}` : 'No tool was invoked.'),
        data: lastInvocation?.result ?? null
    };
}

