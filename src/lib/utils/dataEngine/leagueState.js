import { get } from 'svelte/store';
// We now import the isolated engine store to protect the live site
import { engineMatchupsStore, teamManagersStore, leagueData } from '$lib/stores';

/**
 * Calculates league standings/statistics for a specific season.
 * Uses engineMatchupsStore to allow for historical analysis without 
 * affecting the main website's matchupsStore.
 */
export const getLeagueState = (currentLeagueID) => {
    // 1. Pull latest snapshots from our isolated engine store
    const data = get(engineMatchupsStore);
    const teamManagersData = get(teamManagersStore);
    const allMetadata = get(leagueData);

    // 2. Strict ID Validation:
    // Only proceed if the data in the engineMatchupsStore matches the ID 
    // selected in the UI. This prevents 2025 stats showing for 2024.
    if (!data || !data.matchupWeeks || data.leagueID !== currentLeagueID) {
        return null;
    }

    // 3. Resolve the Year
    let year = allMetadata[currentLeagueID]?.season;
    if (!year && !isNaN(currentLeagueID)) {
        year = currentLeagueID.toString();
    }

    // 4. Map Roster IDs to Managers for this year
    const yearMap = teamManagersData?.teamManagersMap?.[year] || {};
    const stats = {};

    // 5. Iterate through all weeks of data
    data.matchupWeeks.forEach(week => {
        if (!week.matchups) return;

        Object.values(week.matchups).forEach(matchupGroup => {
            const [t1, t2] = matchupGroup;
            if (!t1 || !t2) return;

            // Initialize stats for both teams
            [t1, t2].forEach(t => {
                if (!stats[t.roster_id]) {
                    const teamInfo = yearMap[t.roster_id];
                    
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

            // 6. Aggregate Points
            stats[t1.roster_id].pf += t1.points;
            stats[t1.roster_id].pa += t2.points;
            stats[t2.roster_id].pf += t2.points;
            stats[t2.roster_id].pa += t1.points;

            // 7. Calculate Records
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
