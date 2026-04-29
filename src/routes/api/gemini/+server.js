import { json } from '@sveltejs/kit';
import { GEMINI_API_KEY } from '$env/static/private';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

export const POST = async ({ request }) => {
    try {
        const { message, history, contextData } = await request.json();

        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash", 
            systemInstruction: `You are a helpful league assistant. 
            You are being tested on your ability to read 'contextData'. 
            Answer questions based ONLY on the league information provided in the context.`
        });

        const formattedHistory = (history || []).map(item => ({
            role: item.role === 'user' ? 'user' : 'model',
            parts: [{ text: String(item.text) }],
        }));

        const chat = model.startChat({ history: formattedHistory });

        // Combine the injected context with the user's specific question
        const testPrompt = `
            CONTEXT DATA: ${JSON.stringify(contextData.leagueInfo)}
            
            USER QUESTION: ${message}
        `;

        const result = await chat.sendMessage(testPrompt);
        const response = await result.response;
        
        return json({ text: response.text() });

    } catch (error) {
        console.error("Test Error:", error);
        return json({ error: "The Commish is offline." }, { status: 500 });
    }
};
