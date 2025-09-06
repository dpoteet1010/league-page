<script>
    import { goto } from "$app/navigation";
    import Pagination from "$lib/Pagination.svelte";
    import { getBlogPosts, leagueName, waitForAll } from "$lib/utils/helper";
    import LinearProgress from "@smui/linear-progress";
    import { onMount } from "svelte";
    import Post from "./Post.svelte";
    import { browser } from '$app/environment';

    export let postsData, leagueTeamManagersData, queryPage = 1, filterKey = '';

    let page = queryPage - 1;
    const lang = "en-US";

    let loading = true;
    let allPosts = [];
    let posts = [];
    let leagueTeamManagers = {};
    let categories;

    // 🟢 debug state to show in UI
    let debugMessages = [];

    const log = (msg, data = null) => {
        const formatted = data ? `${msg}: ${JSON.stringify(data, null, 2)}` : msg;
        debugMessages = [...debugMessages, formatted];
    };

    const filterPosts = (ap, fk) => {
        if (ap.length && fk != '') {
            posts = ap.filter(p => p.fields.type == fk);
        } else {
            posts = ap;
        }
    };

    const changeFilter = (fk) => {
        page = 0;
        filterKey = fk;
    };

    $: filterPosts(allPosts, filterKey);

    onMount(async () => {
        log("[BlogPage] onMount start");
        try {
            const [startPostData, leagueTeamManagersResp] =
                await waitForAll(postsData, leagueTeamManagersData);
            log("[BlogPage] startPostData", startPostData);
            log("[BlogPage] leagueTeamManagersResp", leagueTeamManagersResp);

            leagueTeamManagers = leagueTeamManagersResp;
            allPosts = startPostData.posts;
            log("[BlogPage] allPosts length", allPosts?.length);

            loading = false;
            log("[BlogPage] loading set to false");

            const categoryMap = new Set();
            for (const post of startPostData.posts) {
                categoryMap.add(post.fields.type);
            }
            categories = [...categoryMap];
            log("[BlogPage] categories", categories);

            if (!startPostData.fresh) {
                log("[BlogPage] posts not fresh, refetching...");
                const blogResponse = await getBlogPosts(null, true);
                log("[BlogPage] blogResponse", blogResponse);

                allPosts = blogResponse.posts;
                const categoryMap = new Set();
                for (const post of blogResponse.posts) {
                    categoryMap.add(post.fields.type);
                }
                categories = [...categoryMap];
                log("[BlogPage] categories after refresh", categories);
            }
        } catch (err) {
            log("[BlogPage] ERROR", err.message || err);
        }
    });

    const perPage = 10;
    $: total = posts.length;

    let el;
    $: top = el?.getBoundingClientRect() ? el?.getBoundingClientRect().bottom : 0;

    $: displayPosts = posts.slice(page * perPage, (page + 1) * perPage);

    let direction = 1;

    const changePage = (dest) => {
        if (browser) {
            if (dest + 1 > queryPage) {
                direction = 1;
            } else {
                direction = -1;
            }
            goto(`/blog?page=${dest + 1}&filter=${filterKey}`, {
                noscroll: true,
                keepfocus: true
            });
        }
    };

    $: changePage(page);
</script>

<style>
    pre.debug {
        background: #111;
        color: #0f0;
        font-size: 0.75rem;
        padding: 1em;
        border-radius: 0.5em;
        max-height: 300px;
        overflow-y: auto;
        white-space: pre-wrap;
    }
</style>

<h2 bind:this={el}>{leagueName} Blog</h2>

{#if loading}
    <div class="loading">
        <p>Loading league blog posts...</p>
        <LinearProgress indeterminate />
        <pre class="debug">{debugMessages.join("\n\n")}</pre>
    </div>
{:else}
    <div class="filterButtons">
        {#if filterKey == ''}
            {#each categories as category}
                <a class="noUnderline" onclick={() => changeFilter(category)} href="/blog?filter={category}&page=1"><div class="filter filterLink">{category}</div></a>
            {/each}
        {:else}
            <div class="filteringBy">
                Showing <div class="filter filterLink noHover">{filterKey}</div> posts 
                <a class="noUnderline" onclick={() => changeFilter('')} href="/blog?filter=&page=1">
                    <div class="filter filterClear">Clear Filter</div>
                </a>
            </div>
        {/if}
    </div>

    <Pagination {perPage} {total} bind:page={page} target={top} scroll={false} />

    {#each displayPosts as post}
        {#key post.sys.id}
        <Post {leagueTeamManagers} createdAt={post.sys.createdAt} post={post.fields} id={post.sys.id} {direction} />
        {/key}
    {/each}

    <Pagination {perPage} {total} bind:page={page} target={top} scroll={true} />

    <!-- show debug logs even after load -->
    <pre class="debug">{debugMessages.join("\n\n")}</pre>
{/if}
