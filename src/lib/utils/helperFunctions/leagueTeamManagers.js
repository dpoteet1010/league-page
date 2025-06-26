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
        console.log('[getLeagueTeamManagers] Returning cached teamManagersStore');
        return get(teamManagersStore);
    }

    let currentLeagueID = leagueID;
    let teamManagersMap = {};
    let finalUsers = {};
    let currentSeason = null;

    console.log('[getLeagueTeamManagers] Fetching current + historical league data from Sleeper API...');

    // 1. Fetch current + historical data via Sleeper API
    while (currentLeagueID && currentLeagueID != 0) {
        console.log(`[getLeagueTeamManagers] Fetching data for leagueID=${currentLeagueID}`);

        const [usersRaw, leagueData, rostersRaw] = await waitForAll(
            fetch(`https://api.sleeper.app/v1/league/${currentLeagueID}/users`, { compress: true }),
            getLeagueData(currentLeagueID),
            fetch(`https://api.sleeper.app/v1/league/${currentLeagueID}/rosters`, { compress: true }),
        ).catch((err) => {
            console.error('[getLeagueTeamManagers] Error during fetch:', err);
            return [null, null, null];
        });

        if (!usersRaw || !rostersRaw || !leagueData) {
            console.warn(`[getLeagueTeamManagers] Skipping leagueID=${currentLeagueID} due to fetch error`);
            break;
        }

        const [users, rosters] = await waitForAll(
            usersRaw.json(),
            rostersRaw.json(),
        ).catch((err) => {
            console.error('[getLeagueTeamManagers] Error parsing JSON:', err);
            return [null, null];
        });

        if (!users || !rosters) {
            console.warn(`[getLeagueTeamManagers] Skipping leagueID=${currentLeagueID} due to JSON parse error`);
            break;
        }

        const year = parseInt(leagueData.season);
        console.log(`[getLeagueTeamManagers] Processing season year: ${year}`);

        currentLeagueID = leagueData.previous_league_id;
        if (!currentSeason) {
            currentSeason = year;
        }

        teamManagersMap[year] = {};
        const processedUsers = processUsers(users);

        // Add users to finalUsers map (no overwrites)
        for (const userID in processedUsers) {
            if (!finalUsers[userID]) {
                finalUsers[userID] = processedUsers[userID];
            }
        }

        for (const roster of rosters) {
            teamManagersMap[year][roster.roster_id] = {
                team: getTeamData(processedUsers, roster.owner_id),
                managers: getManagers(roster, processedUsers), // Should be array of manager IDs
            };
        }

        console.log(`[getLeagueTeamManagers] Added ${Object.keys(teamManagersMap[year]).length} rosters for season ${year}`);
    }

    // 2. Append legacy data from files
    console.log('[getLeagueTeamManagers] Appending legacy league data...');
    for (const yearStr in legacyLeagueUsers) {
        const seasonYear = parseInt(yearStr);
        const seasonUsersArray = legacyLeagueUsers[seasonYear] || [];
        const seasonRostersMap = legacyLeagueRosters[seasonYear]?.rosters || {};

        console.log(`[getLeagueTeamManagers] Processing legacy season ${seasonYear} with ${seasonUsersArray.length} users and ${Object.keys(seasonRostersMap).length} rosters`);

        teamManagersMap[seasonYear] = {};

        // Convert user array to a map by user_id
        const seasonUsers = {};
        for (const user of seasonUsersArray) {
            seasonUsers[user.user_id] = user;
            if (!finalUsers[user.user_id]) {
                finalUsers[user.user_id] = user;
            }
        }

        for (const rosterID in seasonRostersMap) {
            const roster = seasonRostersMap[rosterID];
            // Use Option A: managers is array of manager IDs (not user objects)
            teamManagersMap[seasonYear][roster.roster_id] = {
                team: getTeamData(seasonUsers, roster.owner_id),
                managers: roster.managers ? [...roster.managers] : [],
            };
        }

        console.log(`[getLeagueTeamManagers] Added ${Object.keys(teamManagersMap[seasonYear]).length} legacy rosters for season ${seasonYear}`);
    }

    const response = {
        currentSeason,
        teamManagersMap,
        users: finalUsers,
    };

    teamManagersStore.update(() => response);
    console.log('[getLeagueTeamManagers] Finished processing all data, updated store and returning response');

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
