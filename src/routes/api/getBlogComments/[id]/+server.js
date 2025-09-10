import contentful from 'contentful';
import { json, error } from '@sveltejs/kit';

export async function GET({ params }) {
    if (!import.meta.env.VITE_CONTENTFUL_CLIENT_ACCESS_TOKEN) {
        throw error(
            500,
            "Missing VITE_CONTENTFUL_CLIENT_ACCESS_TOKEN (added dependency in v2.0), go to https://github.com/nmelhado/league-page/blob/master/TRAINING_WHEELS.md#iii-add-a-blog for directions to add it"
        );
    }

    const client = contentful.createClient({
        space: import.meta.env.VITE_CONTENTFUL_SPACE,
        accessToken: import.meta.env.VITE_CONTENTFUL_CLIENT_ACCESS_TOKEN
    });

    const blogID = params.id;
    console.log("params.id:", blogID);

    let data;
    try {
        data = await client.getEntries({
            content_type: 'blogComment',
            'fields.blogID': blogID
        });
    } catch (e) {
        console.error(e);
        throw error(500, "Problem retrieving blog comments");
    }

    // Inject debug info directly into the JSON response
    return json({
        debug: {
            blogID,
            total: data?.total ?? 0,
            ids: data?.items?.map(item => item.sys.id) ?? []
        },
        ...data
    });
}
