import { json } from '@sveltejs/kit';
import { getLeagueData, getWeeklyMatchups } from '$lib/utils/sleeper'; // Your existing logic
import { GoogleGenerativeAI } from "@google/generative-ai";
import { RECAP_SECRET_KEY, GEMINI_API_KEY } from '$env/static/private';

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

export async function POST({ request }) {
    // 1. Security Check (Prevent random people from triggering your API)
    const { key } = await request.json();
    if (key !== RECAP_SECRET_KEY) return json({ error: 'Unauthorized' }, { status: 401 });

    // 2. Run your existing JS functions to get the "Context Bundle"
    const historicalData = await getPreviousDrafts(); 
    const weeklyData = await getWeeklyMatchups();
    
    // 3. Feed it to Gemini
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `You are a fantasy football analyst. Recap this week's matchups using this data: 
                    ${JSON.stringify(weeklyData)}. 
                    Reference this league history: ${JSON.stringify(historicalData)}.
                    Include trash talk and NFL news. Format as Markdown.`;

    const result = await model.generateContent(prompt);
    const recapHtml = result.response.text();

    // 4. "Publish" it
    // Since you don't have a DB, you can use Contentful's Management API 
    // to automatically create a new entry/post in your CMS.
    await publishToContentful(recapHtml);

    return json({ success: true });
}
