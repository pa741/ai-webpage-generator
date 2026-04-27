import { trackAIInteraction, trackError, trackWebsiteGeneration } from '$lib/analytics';
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import { Runware } from '@runware/sdk-js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
    CEREBRAS_API_KEY,
    RUNWARE_API_KEY
} from '$env/static/private';
import { env } from '$env/dynamic/private';
import { PUBLIC_FIREBASE_PROJECT_ID } from '$env/static/public';
import { logger } from '$lib/logger';

import pageDesignerPrompt from '../../../prompts/page_designer.json';
import htmlGeneratorPrompt from '../../../prompts/html_generator.json';
import actionRunnerPrompt from '../../../prompts/action_runner.json';
import imageDescriptionPrompt from '../../../prompts/image_description.json';
import imageGenerationConfig from '../../../prompts/image_generation.json';

const log = logger.child('PageGenerator');

const client = new Cerebras({ apiKey: CEREBRAS_API_KEY });
const runware = new Runware({ apiKey: RUNWARE_API_KEY });

const MCP_REGION = 'europe-southwest1';
const MAX_TOOL_LOOP_ITERATIONS = 8;

const READ_ONLY_DICTIONARY_TOOLS = new Set([
    'GetWord',
    'SearchWords',
    'GetRandomWord',
    'GetWordOfTheDay',
    'GetFavoriteWords'
]);

const COMPONENT_TOOLS = new Set([
    'GetAllComponents',
    'GetComponents',
    'CreateComponent',
    'UpdateComponent'
]);

interface CerebrasTool {
    type: 'function';
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
    };
}

interface CerebrasMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    name?: string;
    tool_call_id?: string;
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
    }>;
}

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

async function withMcpClient<T>(request: Request, action: (client: Client) => Promise<T>): Promise<T | null> {
    const mcpUrl = resolveMcpUrl(request);
    if (!mcpUrl) {
        log.error('mcp.url_unresolved');
        return null;
    }

    const authorizationHeader = request.headers.get('authorization');
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

async function listMcpToolsAsCerebras(mcp: Client, allow?: (name: string) => boolean): Promise<CerebrasTool[]> {
    const listed = await mcp.listTools();
    const tools = (listed?.tools ?? []) as Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
    return tools
        .filter((tool) => !allow || allow(tool.name))
        .map((tool) => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: (tool.inputSchema && typeof tool.inputSchema === 'object')
                    ? tool.inputSchema
                    : { type: 'object', properties: {} }
            }
        }));
}

interface ToolLoopResult {
    finalText: string;
    toolInvocations: Array<{ name: string; args: Record<string, unknown>; result: unknown }>;
}

async function runMcpToolLoop(input: {
    request: Request;
    model: string;
    systemPrompt: string;
    userPrompt: string;
    allowTool?: (name: string) => boolean;
    responseFormat?: 'text' | 'json_object';
    scope: string;
}): Promise<ToolLoopResult> {
    const result: ToolLoopResult = { finalText: '', toolInvocations: [] };
    const loopLog = log.child(`loop.${input.scope}`, {
        model: input.model,
        prompt_chars: input.userPrompt.length,
        system_chars: input.systemPrompt.length
    });

    const outcome = await withMcpClient(input.request, async (mcp) => {
        const listStop = loopLog.time('list_tools');
        const tools = await listMcpToolsAsCerebras(mcp, input.allowTool);
        listStop({ tool_count: tools.length });

        const messages: CerebrasMessage[] = [
            { role: 'system', content: input.systemPrompt },
            { role: 'user', content: input.userPrompt }
        ];

        for (let iteration = 0; iteration < MAX_TOOL_LOOP_ITERATIONS; iteration += 1) {
            const llmStop = loopLog.time('llm_call', { iteration, message_count: messages.length });
            let completion: any;
            try {
                completion = await client.chat.completions.create({
                    messages: messages as any,
                    model: input.model,
                    tools: tools as any,
                    tool_choice: 'auto',
                    ...(input.responseFormat === 'json_object'
                        ? { response_format: { type: 'json_object' } }
                        : {})
                });
            } catch (error) {
                llmStop({ ok: false, error });
                loopLog.error('llm_call_failed', { iteration, error });
                return result;
            }

            const usage = completion?.usage ?? {};
            llmStop({
                ok: true,
                prompt_tokens: usage.prompt_tokens,
                completion_tokens: usage.completion_tokens,
                total_tokens: usage.total_tokens,
                finish_reason: completion?.choices?.[0]?.finish_reason
            });

            const choice = completion?.choices?.[0]?.message;
            if (!choice) {
                loopLog.warn('llm_no_choice', { iteration });
                break;
            }

            const toolCalls = choice.tool_calls as CerebrasMessage['tool_calls'] | undefined;
            if (toolCalls && toolCalls.length > 0) {
                messages.push({
                    role: 'assistant',
                    content: choice.content ?? null,
                    tool_calls: toolCalls
                });

                for (const call of toolCalls) {
                    const name = call.function.name;
                    let args: Record<string, unknown> = {};
                    try {
                        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
                    } catch (error) {
                        loopLog.warn('tool_args_invalid', { tool: name, raw: call.function.arguments, error });
                    }

                    const toolStop = loopLog.time('tool_call', {
                        tool: name,
                        iteration,
                        arg_keys: Object.keys(args)
                    });

                    let toolResultText: string;
                    try {
                        const toolResponse = await mcp.callTool({ name, arguments: args });
                        const parsed = parseToolJson(toolResponse.content);
                        result.toolInvocations.push({ name, args, result: parsed });
                        toolResultText = typeof parsed === 'string'
                            ? parsed
                            : JSON.stringify(parsed ?? null);
                        toolStop({ ok: true, result_chars: toolResultText.length });
                    } catch (error) {
                        const message = error instanceof Error ? error.message : 'Unknown tool error';
                        result.toolInvocations.push({ name, args, result: { error: message } });
                        toolResultText = JSON.stringify({ error: message });
                        toolStop({ ok: false, error });
                        loopLog.warn('tool_call_failed', { tool: name, iteration, error });
                    }

                    messages.push({
                        role: 'tool',
                        tool_call_id: call.id,
                        name,
                        content: toolResultText
                    });
                }

                continue;
            }

            result.finalText = typeof choice.content === 'string' ? choice.content : '';
            loopLog.info('loop_complete', {
                iterations: iteration + 1,
                tool_calls_total: result.toolInvocations.length,
                final_chars: result.finalText.length
            });
            return result;
        }

        loopLog.warn('loop_max_iterations', {
            iterations: MAX_TOOL_LOOP_ITERATIONS,
            tool_calls_total: result.toolInvocations.length
        });
        return result;
    });

    return outcome ?? result;
}

export interface DesignedPage {
    pageSpec: PageSpec;
    rawDesignerOutput: string;
    usedComponentIds: string[];
}

export async function DesignPage(request: Request, route: string): Promise<DesignedPage> {
    const stop = log.child('design').time('design', { route, model: pageDesignerPrompt.model });
    trackAIInteraction('page_designer_request', pageDesignerPrompt.model);

    const allowTool = (name: string) => COMPONENT_TOOLS.has(name) || READ_ONLY_DICTIONARY_TOOLS.has(name);

    const { finalText, toolInvocations } = await runMcpToolLoop({
        request,
        model: pageDesignerPrompt.model,
        systemPrompt: pageDesignerPrompt.prompt,
        userPrompt: JSON.stringify({ route }),
        allowTool,
        responseFormat: 'json_object',
        scope: 'designer'
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
            const id = invocation.args?.id;
            if (typeof id === 'string' && id.trim()) {
                ids.add(id.trim());
            }
            const result = invocation.result as { id?: unknown } | null;
            if (result && typeof result === 'object' && typeof (result as any).id === 'string') {
                ids.add((result as any).id);
            }
        }
    }

    return Array.from(ids);
}

export async function RequestHtml(_request: Request, pageSpec: PageSpec, usedComponentIds: string[]): Promise<string> {
    const renderLog = log.child('render');
    const stop = renderLog.time('render', {
        model: htmlGeneratorPrompt.model,
        component_count: usedComponentIds.length
    });
    trackAIInteraction('website_generation_request', htmlGeneratorPrompt.model);

    const userPrompt = JSON.stringify({
        pageSpec,
        availableComponents: usedComponentIds
    });

    try {
        const response: any = await client.chat.completions.create({
            messages: [
                { role: 'system', content: htmlGeneratorPrompt.prompt },
                { role: 'user', content: userPrompt }
            ],
            model: htmlGeneratorPrompt.model
        });

        const content = response?.choices?.[0]?.message?.content;
        const usage = response?.usage ?? {};
        if (typeof content !== 'string' || !content.trim()) {
            trackWebsiteGeneration(JSON.stringify(pageSpec), false);
            stop({ ok: false, reason: 'empty_content', ...usage });
            return '<!-- Error generating HTML: No content returned -->';
        }

        const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        trackWebsiteGeneration(JSON.stringify(pageSpec), true);
        stop({
            ok: true,
            html_chars: cleaned.length,
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens
        });
        return cleaned;
    } catch (error) {
        trackWebsiteGeneration(JSON.stringify(pageSpec), false);
        stop({ ok: false, error });
        renderLog.error('render_failed', { error });
        return '<!-- Error generating HTML -->';
    }
}

export interface GeneratedPage {
    prompt: string;
    html: string;
    pageSpec: PageSpec;
    usedComponentIds: string[];
}

export async function GenerateHtml(request: Request, route: string, _referer?: string | null): Promise<GeneratedPage> {
    const designed = await DesignPage(request, route);
    const html = await RequestHtml(request, designed.pageSpec, designed.usedComponentIds);
    return {
        prompt: designed.rawDesignerOutput,
        html,
        pageSpec: designed.pageSpec,
        usedComponentIds: designed.usedComponentIds
    };
}

export async function GenerateHomePage(request: Request): Promise<GeneratedPage> {
    return GenerateHtml(request, '');
}

async function GetImageDescriptionFromRoute(route: string): Promise<string> {
    const stop = log.child('image').time('describe', { route, model: imageDescriptionPrompt.model });
    trackAIInteraction('image_description_generation_request', imageDescriptionPrompt.model);

    try {
        const response: any = await client.chat.completions.create({
            messages: [
                { role: 'system', content: imageDescriptionPrompt.prompt },
                { role: 'user', content: route }
            ],
            model: imageDescriptionPrompt.model
        });
        const description = response?.choices?.[0]?.message?.content ?? '';
        const usage = response?.usage ?? {};
        stop({ ok: true, description_chars: description.length, ...usage });
        return description;
    } catch (error) {
        stop({ ok: false, error });
        log.error('image.describe_failed', { route, error });
        return '';
    }
}

export async function GenerateImageFromRoute(_request: Request, route: string): Promise<string> {
    const imgLog = log.child('image', { route, model: imageGenerationConfig.model });
    const stop = imgLog.time('generate');

    await runware.ensureConnection();
    const description = await GetImageDescriptionFromRoute(route);

    if (!description) {
        stop({ ok: false, reason: 'empty_description' });
        return '';
    }

    try {
        const response = await runware.requestImages({
            model: imageGenerationConfig.model,
            positivePrompt: description,
            negativePrompt: imageGenerationConfig.negativePrompt,
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
        trackAIInteraction('image_generation_request', imageGenerationConfig.model);
        stop({ ok: true, base64_chars: response[0].imageBase64Data.length });
        return response[0].imageBase64Data;
    } catch (error) {
        trackError('Image generation failed', `Route: ${route}`);
        stop({ ok: false, error });
        imgLog.error('runware_failed', { error });
        return '';
    }
}

export async function HandleAction(request: Request): Promise<Response> {
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

    const outputFormat = typeof bodyJson.outputFormat === 'string'
        ? bodyJson.outputFormat
        : '{ "ok": boolean, "message": string, "data": any }';

    trackAIInteraction('action_runner_request', actionRunnerPrompt.model);
    actionLog.info('action_received', {
        body_keys: Object.keys(bodyJson),
        output_format: outputFormat,
        authenticated: Boolean(request.headers.get('authorization'))
    });

    const allowTool = (name: string) => !COMPONENT_TOOLS.has(name);

    const userPrompt = JSON.stringify({
        method,
        route,
        body: bodyJson,
        rawBody: bodyJson && Object.keys(bodyJson).length > 0 ? undefined : bodyText,
        outputFormat,
        authenticated: Boolean(request.headers.get('authorization'))
    });

    const { finalText, toolInvocations } = await runMcpToolLoop({
        request,
        model: actionRunnerPrompt.model,
        systemPrompt: actionRunnerPrompt.prompt,
        userPrompt,
        allowTool,
        responseFormat: 'json_object',
        scope: 'action'
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

