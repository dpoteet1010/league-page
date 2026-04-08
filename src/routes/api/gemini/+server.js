export async function POST({ request }) {
    try {
        const { prompt } = await request.json(); // Get the user's question
        
        // 1. Gather all the context (Managers, History, Transactions)
        const managers = await getLeagueTeamManagers();
        const nflState = await getNflState();
        
        // 2. Start a Chat Session
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const chat = model.startChat({
            history: [
                {
                    role: "user",
                    parts: [{ text: `You are an expert on this fantasy football league. Here is the manager data: ${JSON.stringify(managers)}. Answer questions concisely.` }],
                },
                {
                    role: "model",
                    parts: [{ text: "Understood. I have the league history. What would you like to know?" }],
                },
            ],
        });

        // 3. Send the user's specific question
        const result = await chat.sendMessage(prompt || "Give me a weekly recap.");
        const response = await result.response;

        return json({ text: response.text() });
    } catch (error) {
        return json({ error: error.message }, { status: 500 });
    }
}
