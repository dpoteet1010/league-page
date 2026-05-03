export const getLeagueState = (currentLeagueID) => {
    const data = get(matchupsStore);
    const teamManagersData = get(teamManagersStore);
    const allMetadata = get(leagueData);
    
    if (!data.matchupWeeks) return null;

    // 1. Flexible Year Discovery
    // First check if the ID is actually a year (Legacy style)
    // Otherwise, look up the 'season' field in the metadata (Sleeper style)
    let year = allMetadata[currentLeagueID]?.season;
    
    if (!year && !isNaN(currentLeagueID)) {
        year = currentLeagueID.toString(); // Fallback for '2024', '2023' keys
    }

    const yearMap = teamManagersData?.teamManagersMap?.[year] || {};
    const stats = {};

    data.matchupWeeks.forEach(week => {
        Object.values(week.matchups).forEach(matchupGroup => {
            const [t1, t2] = matchupGroup;

            [t1, t2].forEach(t => {
                if (!stats[t.roster_id]) {
                    const teamInfo = yearMap[t.roster_id];
                    
                    // Look up manager names from the global users map
                    const managerNames = teamInfo?.managers?.map(mID => 
                        teamManagersData.users?.[mID]?.display_name || "Unknown"
                    ).join(' & ') || "Unknown Manager";

                    stats[t.roster_id] = { 
                        wins: 0, losses: 0, pf: 0, pa: 0,
                        manager: managerNames,
                        team: teamInfo?.team?.name || `Team ${t.roster_id}`
                    };
                }
            });

            // Score aggregation remains same...
            stats[t1.roster_id].pf += t1.points;
            stats[t1.roster_id].pa += t2.points;
            stats[t2.roster_id].pf += t2.points;
            stats[t2.roster_id].pa += t1.points;

            if (t1.points > t2.points) {
                stats[t1.roster_id].wins++; stats[t2.roster_id].losses++;
            } else if (t2.points > t1.points) {
                stats[t2.roster_id].wins++; stats[t1.roster_id].losses++;
            }
        });
    });

    return stats;
};
