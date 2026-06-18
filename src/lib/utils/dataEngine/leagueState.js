import { get } from 'svelte/store';
import { engineMatchupsStore, teamManagersStore, leagueData } from '$lib/stores';

export const getLeagueState = (currentLeagueID) => {
    const data = get(engineMatchupsStore);
    const teamManagersData = get(teamManagersStore);
    const allMetadata = get(leagueData);

    // Loosened ID validation to accept string/number mismatches
    if (!data || !data.matchupWeeks || data.leagueID == !currentLeagueID) {
        if (data?.leagueID != currentLeagueID) return null;
    }

    // Resolve the year accurately based on the ID style
    let year = allMetadata[currentLeagueID]?.season;
    if (!year && !isNaN(currentLeagueID)) {
        year = currentLeagueID.toString(); 
    }

    const yearMap = teamManagersData?.teamManagersMap?.[year] || {};
    const stats = {};

    data.matchupWeeks.forEach(week => {
        if (!week.matchups) return;

        Object.values(week.matchups).forEach(matchupGroup => {
            const [t1, t2] = matchupGroup;
            if (!t1 || !t2) return;

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

            // Aggregate Scores cleanly
            stats[t1.roster_id].pf += t1.points;
            stats[t1.roster_id].pa += t2.points;
            stats[t2.roster_id].pf += t2.points;
            stats[t2.roster_id].pa += t1.points;

            // Calculate Records
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
