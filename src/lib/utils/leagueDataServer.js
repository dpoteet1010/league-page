import { leagueID as currentID } from '$lib/utils/leagueInfo';

export const getLeagueData = async (targetID = currentID) => {
    // Check if it's a legacy year
    if (targetID === "2023" || targetID === "2024") {
        // Return your manual data object here
        return {
            season: targetID,
            name: "National Liver Failure League (Legacy)",
            status: "complete"
        };
    }

    const res = await fetch(`https://api.sleeper.app/v1/league/${targetID}`);
    if (!res.ok) throw new Error(`League Data Fetch Failed for ${targetID}`);
    return await res.json();
}
