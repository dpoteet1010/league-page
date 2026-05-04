import { get } from 'svelte/store';
import { matchupsStore, teamManagersStore, leagueData } from '$lib/stores';

/**
 * Calculates the league standings and stats for a specific season.
 * @param {string} currentLeagueID - The ID of the league/season to calculate.
 */
export const getLeagueState = (currentLeagueID) => {
    // 1. Pull the latest snapshots from the stores
    const data = get(matchupsStore);
    const teamManagersData = get(teamManagersStore);
    const allMetadata = get(leagueData);

    // 2. STRICTOR VALIDATION: 
    // We check if the data in the store actually belongs to the ID we requested.
    // This prevents "stale data" from one season showing up under another season's header.
    if (!data || !data.matchupWeeks || data.leagueID !== currentLeagueID) {
        return null;
    }

    // 3. Resolve the Year (Season) string
    // This connects the Sleeper League ID to the keys used in teamManagersMap
    let year = allMetadata[currentLeagueID]?.season;
    
    // Fallback: If it's a legacy ID (which is just the year string), use it directly
    if (!year && !isNaN(currentLeagueID)) {
        year = currentLeagueID.toString();
    }

    // 4. Get the mapping of roster_ids to managers for this specific year
    const yearMap = teamManagersData?.teamManagersMap?.[year] || {};
    const stats = {};

    // 5. Process every week and every matchup
    data.matchupWeeks.forEach(week => {
        // Skip weeks with no matchup data
        if (!week.matchups) return;

        Object.values(week.matchups).forEach(matchupGroup => {
            const [t1, t2] = matchupGroup;

            // Ensure both teams exist in the matchup
            if (!t1 || !t2) return;

            [t1, t2].forEach(t => {
                // Initialize the team object if we haven't seen this roster_id yet
                if (!stats[t.roster_id]) {
                    const teamInfo = yearMap[t.roster_id];
                    
                    // Convert manager IDs into Display Names (e.g., "John & Jane")
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

            // 6. Aggregate Points For (PF) and Points Against (PA)
            stats[t1.roster_id].pf += t1.points;
            stats[t1.roster_id].pa += t2.points;
            
            stats[t2.roster_id].pf += t2.points;
            stats[t2.roster_id].pa += t1.points;

            // 7. Calculate Wins and Losses
            if (t1.points > t2.points) {
                stats[t1.roster_id].wins++;
                stats[t2.roster_id].losses++;
            } else if (t2.points > t1.points) {
                stats[t2.roster_id].wins++;
                stats[t1.roster_id].losses++;
            }
            // Note: Ties are currently ignored in record (0.5 wins not added)
        });
    });

    return stats;
};
