export async function POST({ request }) {
    try {
        const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
        const genAI = new GoogleGenerativeAI(apiKey);

        // --- DYNAMIC MODEL SELECTION ---
        // 1. Get all available models from Google
        const modelList = await genAI.listModels();
        
        // 2. Find the best "Flash" model that supports text generation
        // We look for "flash" and ensure it can "generateContent"
        const bestModel = modelList.models.find(m => 
            m.name.includes('flash') && 
            m.supportedGenerationMethods.includes('generateContent')
        );

        // 3. Fallback if no flash model is found (unlikely but safe)
        const modelId = bestModel ? bestModel.name : "models/gemini-2.0-flash"; 
        
        console.log(`🚀 Dynamically selected model: ${modelId}`);
        const model = genAI.getGenerativeModel({ model: modelId });
        // -------------------------------

        const body = await request.json();
        const [managers, nflState, leagueData] = await Promise.all([
            getLeagueTeamManagers(),
            getNflState(),
            getLeagueData()
        ]);

        const chat = model.startChat({
            history: [
                {
                    role: "user",
                    parts: [{ text: `You are the AI Commissioner for ${leagueData.name}.` }],
                },
                {
                    role: "model",
                    parts: [{ text: "Acknowledged." }],
                },
            ],
        });

        const result = await chat.sendMessage(body.prompt || "Hello");
        const response = await result.response;
        
        return json({ text: response.text() });

    } catch (error) {
        console.error("DYNAMIC API ERROR:", error.message);
        return json({ text: `SYSTEM CRASH: ${error.message}` }, { status: 500 });
    }
}
