import { get } from 'svelte/store';
import { matchupsStore, teamManagersStore, leagueData } from '$lib/stores';

export const getLeagueState = (currentLeagueID) => {
    // 1. Pull current snapshots of all stores
    const data = get(matchupsStore);
    const teamManagersData = get(teamManagersStore);
    const allMetadata = get(leagueData);
    
    // Safety check: if matchups haven't loaded, return null
    if (!data || !data.matchupWeeks) return null;

    // 2. Resolve Year (Handles legacy IDs like "2023" and Sleeper IDs)
    let year = allMetadata[currentLeagueID]?.season;
    if (!year && !isNaN(currentLeagueID)) {
        year = currentLeagueID.toString(); 
    }

    // 3. Get the roster-to-manager mapping for this specific year
    const yearMap = teamManagersData?.teamManagersMap?.[year] || {};
    const stats = {};

    // 4. Iterate through weeks and matchups
    data.matchupWeeks.forEach(week => {
        if (!week.matchups) return;

        Object.values(week.matchups).forEach(matchupGroup => {
            const [t1, t2] = matchupGroup;
            if (!t1 || !t2) return;

            // Initialize stats for both teams if they don't exist
            [t1, t2].forEach(t => {
                if (!stats[t.roster_id]) {
                    const teamInfo = yearMap[t.roster_id];
                    
                    // Map Manager IDs to Display Names
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

            // 5. Update Points For and Points Against
            stats[t1.roster_id].pf += t1.points;
            stats[t1.roster_id].pa += t2.points;
            stats[t2.roster_id].pf += t2.points;
            stats[t2.roster_id].pa += t1.points;

            // 6. Update Wins and Losses
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
