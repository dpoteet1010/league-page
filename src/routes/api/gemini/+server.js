import { json } from '@sveltejs/kit';
import { GEMINI_API_KEY } from '$env/static/private';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

export const POST = async ({ request }) => {
    try {
        const { message, history, contextData } = await request.json();

        const model = genAI.getGenerativeModel({ 
            model: "gemini-flash-latest", 
            systemInstruction: `You are the League Commish. You are a data-driven analyst.
            Use the provided contextData to answer questions. 
            The contextData includes live data for the current season and legacy data for past seasons.
            
            Always bridge Roster IDs to Real Names using the mapping provided.
            Be professional, concise, and witty.`
        });

        const formattedHistory = (history || []).map(item => ({
            role: item.role === 'user' ? 'user' : 'model',
            parts: [{ text: String(item.text) }],
        }));

        const chat = model.startChat({ history: formattedHistory });

        // We combine the message with the context data for the ultimate prompt
        const fullPrompt = `
            CONTEXT DATA: ${JSON.stringify(contextData)}
            
            USER QUESTION: ${message}
        `;

        const result = await chat.sendMessage(fullPrompt);
        const response = await result.response;
        
        return json({ text: response.text() });

    } catch (error) {
        console.error("Gemini Error:", error);
        return json({ error: "Commish is offline." }, { status: 500 });
    }
};
