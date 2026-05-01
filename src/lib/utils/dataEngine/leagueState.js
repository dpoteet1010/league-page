import { get } from 'svelte/store';
import { matchupsStore } from '$lib/stores';

export const getLeagueState = () => {
    const data = get(matchupsStore);
    if (!data.matchupWeeks) return null;

    const stats = {};

    // We iterate over the ALREADY processed weeks in your store
    data.matchupWeeks.forEach(week => {
        Object.values(week.matchups).forEach(matchupGroup => {
            const [t1, t2] = matchupGroup;

            // Initialize if new
            [t1, t2].forEach(t => {
                if (!stats[t.roster_id]) {
                    stats[t.roster_id] = { wins: 0, losses: 0, pf: 0, pa: 0 };
                }
            });

            // Update stats
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

    // Transform into a compact string or small JSON for the AI
    return stats;
};
