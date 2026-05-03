import { get } from 'svelte/store';
import { matchupsStore, teamManagersStore, leagueData } from '$lib/stores';

export const getLeagueState = (currentLeagueID) => {
    const data = get(matchupsStore);
    const teamManagersData = get(teamManagersStore);
    const allLeagueMetadata = get(leagueData);
    
    if (!data.matchupWeeks) return null;

    // 1. Resolve LeagueID to Season/Year
    // We look in the leagueData store for the object associated with this ID
    const seasonMetadata = allLeagueMetadata[currentLeagueID];
    const year = seasonMetadata?.season; // This will be "2023", "2024", etc.

    if (!year) {
        console.warn(`[getLeagueState] No season year found for LeagueID: ${currentLeagueID}`);
    }

    const yearMap = teamManagersData?.teamManagersMap?.[year] || {};
    const stats = {};

    data.matchupWeeks.forEach(week => {
        Object.values(week.matchups).forEach(matchupGroup => {
            const [t1, t2] = matchupGroup;

            [t1, t2].forEach(t => {
                if (!stats[t.roster_id]) {
                    const teamInfo = yearMap[t.roster_id];
                    
                    // Map manager IDs to Display Names using the year-specific map
                    const managerNames = teamInfo?.managers?.map(mID => 
                        teamManagersData.users?.[mID]?.display_name || "Unknown"
                    ).join(' & ') || "Unknown Manager";

                    stats[t.roster_id] = { 
                        wins: 0, 
                        losses: 0, 
                        pf: 0, 
                        pa: 0,
                        manager: managerNames,
                        team: teamInfo?.team?.name || `Team ${t.roster_id}`
                    };
                }
            });

            // Scoring Logic
            stats[t1.roster_id].pf += t1.points;
            stats[t1.roster_id].pa += t2.points;
            stats[t2.roster_id].pf += t2.points;
            stats[t2.roster_id].pa += t1.points;

            if (t1.points > t2.points) {
                stats[t1.roster_id].wins++;
                stats[t2.roster_id].losses++;
            } else if (t2.points > t1.points) {
                stats[t2.roster_id].wins++;
                stats[t1.roster_id].losses++;
            }
        });
    });

    return stats;
};
