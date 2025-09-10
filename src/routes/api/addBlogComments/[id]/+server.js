import contentful from 'contentful-management';
import { json, error } from '@sveltejs/kit';
import { getLeagueTeamManagers } from "$lib/utils/helper";

const lang = "en-US";

export async function POST({ request, params }) {
    const { comment: rawComment, author: rawAuthor, postID } = await request.json();

    // UI logging function for Vercel
    const logToUI = (msg) => {
        console.log(`[COMMENT POST] ${msg}`);
    };

    if (!rawComment || rawComment.trim() === "") {
        return json({ error: "Comment cannot be empty" }, { status: 400 });
    }

    if (!rawAuthor || rawAuthor.trim() === "") {
        return json({ error: "Author cannot be empty" }, { status: 400 });
    }

    logToUI(`Received comment: "${rawComment}" by author: "${rawAuthor}" for postID: ${postID}`);

    // Fetch league managers
    const leagueTeamManagers = await getLeagueTeamManagers();

    // Map author input to valid userID
    const authorID = mapAuthorToID(leagueTeamManagers, rawAuthor);
    if (!authorID) {
        return json({ error: `Invalid author: "${rawAuthor}"` }, { status: 400 });
    }

    logToUI(`Mapped author "${rawAuthor}" to userID: ${authorID}`);

    // Initialize Contentful client
    const client = contentful.createClient({
        accessToken: import.meta.env.VITE_CONTENTFUL_ACCESS_TOKEN
    });

    const space = await client.getSpace(import.meta.env.VITE_CONTENTFUL_SPACE)
        .catch(e => {
            logToUI(`Error getting Contentful space: ${e}`);
            throw error(500, "Problem getting Contentful space");
        });

    const environment = await space.getEnvironment('master')
        .catch(e => {
            logToUI(`Error getting Contentful environment: ${e}`);
            throw error(500, "Problem getting Contentful environment");
        });

    // Prepare fields
    const fields = {
        blogID: { [lang]: postID },
        comment: { [lang]: rawComment },
        author: { [lang]: authorID }
    };

    logToUI(`Creating entry with fields: ${JSON.stringify(fields, null, 2)}`);

    // Create and publish entry
    const newComment = await environment.createEntry('blogComment', { fields })
        .catch(e => {
            logToUI(`Error creating entry: ${e}`);
            throw error(500, "Problem adding comment");
        });

    await newComment.publish()
        .catch(e => {
            logToUI(`Error publishing entry: ${e}`);
            throw error(500, "Problem publishing comment");
        });

    logToUI(`Successfully added and published comment with sys.id: ${newComment.sys.id}`);

    // Return a simplified object for the UI
    return json({
        id: newComment.sys.id,
        fields: {
            blogID: postID,
            comment: rawComment,
            author: rawAuthor
        }
    });
}

// Map UI author input to numeric userID in leagueTeamManagers
function mapAuthorToID(leagueTeamManagers, input) {
    if (!input || !leagueTeamManagers?.users) return false;

    const auth = input.trim().toLowerCase();
    for (const userID in leagueTeamManagers.users) {
        const user = leagueTeamManagers.users[userID];
        const uname = user.user_name?.trim().toLowerCase();
        const dname = user.display_name?.trim().toLowerCase();
        if (uname === auth || dname === auth) {
            return userID;
        }
    }
    return false;
}
