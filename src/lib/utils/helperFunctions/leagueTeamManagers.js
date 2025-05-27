import { leagueID, managers } from '$lib/utils/leagueInfo';
import { get } from 'svelte/store';
import { teamManagersStore } from '$lib/stores';
import { waitForAll } from './multiPromise';
import { getManagers, getTeamData } from './universalFunctions';
import { getLeagueData } from './leagueData';
import { legacyLeagueUsers } from './legacyLeagueUsers';
import { legacyLeagueRosters } from './legacyLeagueRosters';

export const getLeagueTeamManagers = async () => {
    if (get(teamManagersStore) && get(teamManagersStore).currentSeason) {
        return get(teamManagersStore);
    }

    let currentLeagueID = leagueID;
    let teamManagersMap = {};
    let finalUsers = {};
    let currentSeason = null;

    // 1. Fetch current + historical data via Sleeper API
    while (currentLeagueID && currentLeagueID != 0) {
        const [usersRaw, leagueData, rostersRaw] = await waitForAll(
            fetch(`https://api.sleeper.app/v1/league/${currentLeagueID}/users`, { compress: true }),
            getLeagueData(currentLeagueID),
            fetch(`https://api.sleeper.app/v1/league/${currentLeagueID}/rosters`, { compress: true }),
        ).catch((err) => { console.error(err); });

        const [users, rosters] = await waitForAll(
            usersRaw.json(),
            rostersRaw.json(),
        ).catch((err) => { console.error(err); });

        const year = parseInt(leagueData.season);
        currentLeagueID = leagueData.previous_league_id;
        if (!currentSeason) {
            currentSeason = year;
        }

        teamManagersMap[year] = {};
        const processedUsers = processUsers(users);

        // Add users to finalUsers map
        for (const userID in processedUsers) {
            if (!finalUsers[userID]) {
                finalUsers[userID] = processedUsers[userID];
            }
        }

        for (const roster of rosters) {
            teamManagersMap[year][roster.roster_id] = {
                team: getTeamData(processedUsers, roster.owner_id),
                managers: getManagers(roster, processedUsers),
            };
        }
    }

    // 2. Append legacy data from files
for (const year in legacyLeagueUsers) {
    const seasonYear = parseInt(year);
    const seasonUsersArray = legacyLeagueUsers[seasonYear] || [];
    const seasonRostersMap = legacyLeagueRosters[seasonYear]?.rosters || {};

    teamManagersMap[seasonYear] = {};

    // Convert user array to a map by user_id
    const seasonUsers = {};
    for (const user of seasonUsersArray) {
        seasonUsers[user.user_id] = user;
        // Add to finalUsers as well
        if (!finalUsers[user.user_id]) {
            finalUsers[user.user_id] = user;
        }
    }

    for (const rosterID in seasonRostersMap) {
        const roster = seasonRostersMap[rosterID];
        console.log(`Year ${seasonYear} — Roster ${roster.roster_id} owned by ${roster.owner_id}:`, seasonUsers[roster.owner_id]?.display_name);
        teamManagersMap[seasonYear][roster.roster_id] = {
            team: getTeamData(seasonUsers, roster.owner_id),
            managers: roster.managers ? roster.managers.map(mid => seasonUsers[mid]) : [],
        };
    }
}

    const response = {
        currentSeason,
        teamManagersMap,
        users: finalUsers,
    };

    teamManagersStore.update(() => response);
    return response;
};

const processUsers = (rawUsers) => {
    let finalUsers = {};
    for (const user of rawUsers) {
        user.user_name = user.user_name ?? user.display_name;
        finalUsers[user.user_id] = user;
        const manager = managers.find(m => m.managerID === user.user_id);
        if (manager) {
            finalUsers[user.user_id].display_name = manager.name;
        }
    }
    return finalUsers;
};
