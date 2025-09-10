import contentful from 'contentful-management';
import { json, error } from '@sveltejs/kit';
import { getLeagueTeamManagers } from "$lib/utils/helper";

const lang = "en-US";

export async function POST({request, params}) {
    let log = [];

    try {
        log.push(`Received request for authorID: ${params.id}`);

        const { comment, postID } = await request.json();
        log.push(`Payload comment: "${comment}", postID: ${postID}`);

        const leagueTeamManagers = await getLeagueTeamManagers();
        log.push("Fetched leagueTeamManagers");

        const author = validateID(leagueTeamManagers, params.id);
        log.push(`Validated author: ${author}`);

        if (!author) {
            log.push("Invalid author");
            return json({success: false, log, error: "Invalid author"}, {status: 400});
        }

        const client = contentful.createClient({
            accessToken: import.meta.env.VITE_CONTENTFUL_ACCESS_TOKEN,
        });
        const space = await client.getSpace(import.meta.env.VITE_CONTENTFUL_SPACE);
        const environment = await space.getEnvironment('master');
        log.push("Connected to Contentful environment");

        const fields = {
            blogID: {[lang]: postID},
            comment: {[lang]: comment},
            author: {[lang]: author}
        };
        log.push("Prepared fields for Contentful", JSON.stringify(fields, null, 2));

        const newComment = await environment.createEntry('blogComment', {fields});
        await newComment.publish();
        log.push("Comment created and published");

        return json({success: true, comment: newComment, log});

    } catch (err) {
        console.error(err);
        log.push(`Error: ${err.message || err}`);
        return json({success: false, log, error: err.message || 'Unknown error'}, {status: 500});
    }
}

const validateID = (leagueTeamManagers, authorID) => {
    if (leagueTeamManagers.users[authorID]) {
        return leagueTeamManagers.users[authorID].user_name.toLowerCase();
    }
    return false;
};
