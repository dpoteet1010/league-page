import { get } from 'svelte/store';
import { matchupsStore, teamManagersStore } from '$lib/stores';

export const getLeagueState = (currentLeagueID) => {
    const data = get(matchupsStore);
    const teamManagersData = get(teamManagersStore);
    
    if (!data.matchupWeeks) return null;

    const stats = {};

    // 1. Find the season year that corresponds to this League ID
    // We search the teamManagersMap to see which year contains this league's data
    const yearEntry = Object.entries(teamManagersData?.teamManagersMap || {}).find(
        ([year, rosters]) => {
            // Check if any roster in this year belongs to the currentLeagueID
            // Note: If your map doesn't store leagueID per roster, 
            // you can also pass 'year' directly from the UI dropdown.
            return data.leagueID === currentLeagueID; 
        }
    );

    const year = yearEntry ? yearEntry[0] : null;
    const yearMap = teamManagersData?.teamManagersMap?.[year] || {};

    data.matchupWeeks.forEach(week => {
        Object.values(week.matchups).forEach(matchupGroup => {
            const [t1, t2] = matchupGroup;

            [t1, t2].forEach(t => {
                if (!stats[t.roster_id]) {
                    const teamInfo = yearMap[t.roster_id];
                    
                    // Map manager IDs to Display Names
                    const managerNames = teamInfo?.managers?.map(mID => 
                        teamManagersData.users[mID]?.display_name || "Unknown"
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

            // Math logic
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
