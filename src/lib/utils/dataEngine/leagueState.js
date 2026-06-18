import { get } from 'svelte/store';
import { engineMatchupsStore, teamManagersStore, leagueData } from '$lib/stores';

export const getLeagueState = (currentLeagueID) => {
    const data = get(engineMatchupsStore);
    const teamManagersData = get(teamManagersStore);
    const allMetadata = get(leagueData);

    // 1. Unified ID verification check
    if (!data || !data.matchupWeeks || data.leagueID != currentLeagueID) {
        return null;
    }

    let year = allMetadata[currentLeagueID]?.season;
    if (!year && !isNaN(currentLeagueID)) {
        year = currentLeagueID.toString(); 
    }

    const yearMap = teamManagersData?.teamManagersMap?.[year] || {};
    const stats = {};

    // 2. Loop through every week
    data.matchupWeeks.forEach(week => {
        if (!week.matchups) return;

        Object.values(week.matchups).forEach(matchupGroup => {
            const [t1, t2] = matchupGroup;
            if (!t1 || !t2) return;

            // Initialize stats entry for both teams
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

            // 3. Extract points precisely
            const t1Points = Number(t1.points || 0);
            const t2Points = Number(t2.points || 0);

            // 4. Aggregate Scores
            stats[t1.roster_id].pf += t1Points;
            stats[t1.roster_id].pa += t2Points;

            stats[t2.roster_id].pf += t2Points;
            stats[t2.roster_id].pa += t1Points;

            // 5. Calculate Standings
            if (t1Points > t2Points) {
                stats[t1.roster_id].wins++;
                stats[t2.roster_id].losses++;
            } else if (t2Points > t1Points) {
                stats[t2.roster_id].wins++;
                stats[t1.roster_id].losses++;
            } else {
                stats[t1.roster_id].ties++;
                stats[t2.roster_id].ties++;
            }
        });
    });

    return stats;
};
