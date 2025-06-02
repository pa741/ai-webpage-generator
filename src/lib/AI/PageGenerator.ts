import Cerebras from '@cerebras/cerebras_cloud_sdk';

const client = new Cerebras({
    apiKey: process.env['CEREBRAS_API_KEY'], // This is the default and can be omitted
});


export async function GenerateHtml(route: string) {
    const systemPrompt = ""

    let response = await client.chat.completions.create({
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: route }],
        model: "qwen-3-32b"
    })
    let description = (response.choices as any)[0]?.message as string;

    return await RequestHtml(description);


}
async function RequestHtml(description: string) {
    const systemPrompt = ""

    let response = await client.chat.completions.create({
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: description }],
        model: "qwen-3-32b"
    })
    let html = (response.choices as any)[0]?.message as string;
    return html;
}