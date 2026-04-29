export const getAwards = async () => {
    const podiums = [];
    const processedYears = new Set();

    // 1. SLEEPER CHAIN (Ends at 2025)
    let currentID = defaultLeagueID;
    while (currentID && currentID !== "0") {
        const seasonData = await getSeasonPodiumData(currentID);
        if (!seasonData) break;

        podiums.push(seasonData.podium);
        processedYears.add(seasonData.year);

        // Sleeper chain will naturally die here when 2025's prev_id is "0"
        currentID = seasonData.previousSeasonID;
    }

    // 2. LEGACY BRIDGE (Forces 2024 and 2023)
    const legacyYears = ["2024", "2023"];
    for (const year of legacyYears) {
        if (!processedYears.has(Number(year))) {
            const legacySeason = await getSeasonPodiumData(year);
            if (legacySeason) {
                podiums.push(legacySeason.podium);
            }
        }
    }

    return podiums.sort((a, b) => b.year - a.year);
};
