import contentful from 'contentful-management';
import { json, error } from '@sveltejs/kit';

import { getLeagueTeamManagers } from "$lib/utils/helper";

const lang = "en-US";

export async function POST({ request, params }) {
    try {
        // Log incoming request
        const rawBody = await request.text();
        console.log("[DEBUG] Raw request body:", rawBody);

        // Parse JSON body
        let body;
        try {
            body = JSON.parse(rawBody);
        } catch (e) {
            console.error("[ERROR] Failed to parse JSON body", e);
            throw error(400, "Invalid JSON body");
        }

        const { comment, postID } = body;
        console.log("[DEBUG] Extracted comment:", comment, "postID:", postID);

        const authorName = params.id;
        console.log("[DEBUG] Incoming authorName (params.id):", authorName);

        // Setup Contentful client
        const client = contentful.createClient({
            accessToken: import.meta.env.VITE_CONTENTFUL_ACCESS_TOKEN,
        });

        const space = await client.getSpace(import.meta.env.VITE_CONTENTFUL_SPACE);
        const environment = await space.getEnvironment('master');

        // Get managers
        const leagueTeamManagers = await getLeagueTeamManagers();
        console.log("[DEBUG] LeagueTeamManagers.users keys:", Object.keys(leagueTeamManagers.users || {}));

        // Validate author
        const author = validateID(leagueTeamManagers, authorName);
        console.log("[DEBUG] Validated author:", author);

        if (!author) {
            throw error(400, "Invalid author");
        }

        // Build fields
        const fields = {
            blogID: { [lang]: postID },
            comment: { [lang]: comment },
            author: { [lang]: author }
        };
        console.log("[DEBUG] Fields being sent to Contentful:", JSON.stringify(fields, null, 2));

        // Create + publish entry
        const newComment = await environment.createEntry('blogComment', { fields });
        console.log("[DEBUG] Created comment entry ID:", newComment.sys?.id);

        await newComment.publish();
        console.log("[DEBUG] Published comment entry ID:", newComment.sys?.id);

        // Return simplified object
        return json({
            id: newComment.sys?.id,
            blogID: postID,
            comment,
            author
        });
    } catch (err) {
        console.error("[FATAL ERROR] in addBlogComments API:", err);
        throw error(500, `Comment API failed: ${err.message || err}`);
    }
}

const validateID = (leagueTeamManagers, authorName) => {
    if (!leagueTeamManagers?.users) return false;
    const auth = authorName?.trim().toLowerCase();

    for (const uID in leagueTeamManagers.users) {
        const user = leagueTeamManagers.users[uID];
        if (user.user_name?.trim().toLowerCase() === auth) {
            return user.user_name.toLowerCase(); // store username
        }
    }
    return false;
};
