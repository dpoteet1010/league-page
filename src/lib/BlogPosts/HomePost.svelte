<script>
    import { onMount } from "svelte";
    import LinearProgress from '@smui/linear-progress';
    import Post from "./Post.svelte";
    import { getBlogPosts, getLeagueTeamManagers, waitForAll } from "$lib/utils/helper";

    const lang = "en-US";

    let post;
    let createdAt;
    let id;
    let loading = true;
    let leagueTeamManagers = {};

    onMount(async () => {
        console.log("[BlogWidget] onMount start");

        try {
            console.time("[BlogWidget] waitForAll");
            const [{ posts, fresh }, leagueTeamManagersData] =
                await waitForAll(getBlogPosts(null), getLeagueTeamManagers());
            console.timeEnd("[BlogWidget] waitForAll");
            console.log("[BlogWidget] posts from waitForAll:", posts);
            console.log("[BlogWidget] leagueTeamManagersData:", leagueTeamManagersData);

            leagueTeamManagers = leagueTeamManagersData;

            for (const singlePost of posts) {
                if (singlePost.fields.featured) {
                    createdAt = singlePost.sys.createdAt;
                    post = singlePost.fields;
                    id = singlePost.sys.id;
                    break;
                }
            }

            if (!fresh) {
                console.log("[BlogWidget] posts not fresh, refetching…");
                const { posts: freshPosts } = await getBlogPosts(null, true);
                console.log("[BlogWidget] freshPosts:", freshPosts);

                for (const singlePost of freshPosts) {
                    if (singlePost.fields.featured) {
                        createdAt = singlePost.sys.createdAt;
                        post = singlePost.fields;
                        id = singlePost.sys.id;
                        break;
                    }
                }
            }

            console.log("[BlogWidget] Done, setting loading=false");
            loading = false;
        } catch (err) {
            console.error("[BlogWidget] ERROR in onMount:", err);
        }
    });
</script>

<style>
    .loading {
        display: block;
        width: 85%;
        max-width: 500px;
        margin: 80px auto;
    }

    h2 {
        font-size: 2em;
        text-align: center;
        margin-bottom: 1.5em;
    }

    .center {
        text-align: center;
        margin-bottom: 2em;
    }

    .viewAll {
        text-decoration: none;
        background-color: #920505;
        color: #fff;
        border-radius: 1em;
        padding: 0.5em 1em;
    }

    .viewAll:hover {
        background-color: #670404;
    }
</style>

{#if loading}
    <!-- promise is pending -->
    <div class="loading">
        <p>Loading Blog Posts...</p>
        <LinearProgress indeterminate />
    </div>
{:else}
    <h2>League Blog</h2>
    <Post {leagueTeamManagers} {post} {createdAt} {id} />
    <div class="center">
        <a class="viewAll" href="/blog">View More Blog Posts</a>
    </div>
{/if}
