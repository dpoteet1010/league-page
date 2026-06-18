import { get } from 'svelte/store';
import { engineMatchupsStore, teamManagersStore, leagueData } from '$lib/stores';

/**
 * Accurately calculates league standings/statistics for a selected season.
 * Processes matchups by grouping teams with identical matchup_ids per week.
 */
export const getLeagueState = (currentLeagueID) => {
    const data = get(engineMatchupsStore);
    const teamManagersData = get(teamManagersStore);
    const allMetadata = get(leagueData);

    // 1. Safe ID matching check (handles string vs number comparisons safely)
    if (!data || !data.matchupWeeks || data.leagueID != currentLeagueID) {
        return null;
    }

    // 2. Determine the year for manager mapping context
    let year = allMetadata[currentLeagueID]?.season;
    if (!year && !isNaN(currentLeagueID)) {
        year = currentLeagueID.toString(); 
    }

    const yearMap = teamManagersData?.teamManagersMap?.[year] || {};
    const stats = {};

    // 3. Process each week
    data.matchupWeeks.forEach(week => {
        if (!week.matchups) return;

        // Group matchups by their matchup_id for this specific week
        // Sleeper groups them sequentially: matchup_id 1 has 2 teams, matchup_id 2 has 2 teams, etc.
        Object.values(week.matchups).forEach(matchupGroup => {
            const [t1, t2] = matchupGroup;
            
            // Ensure we have a valid head-to-head pairing
            if (!t1 || !t2) return;

            // Initialize stats entry for both teams if they don't exist yet
            [t1, t2].forEach(t => {
                if (!stats[t.roster_id]) {
                    const teamInfo = yearMap[t.roster_id];
                    
                    const managerNames = teamInfo?.managers?.map(mID => 
                        teamManagersData.users?.[mID]?.display_name || "Unknown"
                    ).join(' & ') || "Unknown Manager";

                    stats[t.roster_id] = { 
                        wins: 0, 
                        losses: 0, 
                        ties: 0,
                        pf: 0, 
                        pa: 0,
                        manager: managerNames,
                        team: teamInfo?.team?.name || `Team ${t.roster_id}`
                    };
                }
            });

            // 4. FIXED: Extract points using the correct property names from your schema
            const t1Points = Number(t1.points || 0);
            const t2Points = Number(t2.points || 0);

            // 5. Aggregate Points For (PF) and Points Against (PA)
            stats[t1.roster_id].pf += t1Points;
            stats[t1.roster_id].pa += t2Points;

            stats[t2.roster_id].pf += t2Points;
            stats[t2.roster_id].pa += t1Points;

            // 6. Calculate Wins, Losses, and Ties
            if (t1Points > t2Points) {
                stats[t1.roster_id].wins++;
                stats[t2.roster_id].losses++;
            } else if (t2Points > t1Points) {
                stats[t2.roster_id].wins++;
                stats[t1.roster_id].losses++;
            } else {
                // Handle rare stat correction ties perfectly
                stats[t1.roster_id].ties++;
                stats[t2.roster_id].ties++;
            }
        });
    });

    return stats;
};
