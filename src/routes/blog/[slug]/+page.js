import { enableBlog, getBlogPosts, getLeagueTeamManagers } from '$lib/utils/helper';

export async function load({ fetch, params }) {
    if (!enableBlog) return false;

    const postID = params.slug;

    // Resolve both async calls before returning
    const [postsData, leagueTeamManagersData] = await Promise.all([
        getBlogPosts(fetch),
        getLeagueTeamManagers()
    ]);

    return {
        postsData,
        postID,
        leagueTeamManagersData,
    };
}
