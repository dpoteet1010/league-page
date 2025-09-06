<script>
  import { fly } from "svelte/transition";
  import AuthorAndDate from "./AuthorAndDate.svelte";
  import { generateParagraph } from "$lib/utils/helper";

  export let leagueTeamManagers;
  export let post;
  export let createdAt;
  export let id = null;
  export let direction = 1;

  let safePost = false;
  let title, body, type, author;

  // Normalize Contentful post fields
  if (post) {
    const normalized = post.fields ? post.fields : post;
    ({ title, body, type, author } = normalized);

    if (!title) {
      console.error("Invalid post: No title provided");
    } else if (!body) {
      console.error(`Invalid post (${title}): No body provided`);
    } else if (!type) {
      console.error(`Invalid post (${title}): No type provided`);
    } else if (!author) {
      console.error(`Invalid post (${title}): No author provided`);
    } else {
      safePost = true;
    }
  }

  const duration = 300;
  let e;

  // Track overflow for fade effect
  $: isOverflown = e ? e.scrollHeight > e.clientHeight : false;

  // Resolve author name to manager ID for AuthorAndDate
  $: authorId = null;
  if (leagueTeamManagers?.users && author) {
    const userEntry = Object.values(leagueTeamManagers.users).find(u => u.display_name === author);
    if (userEntry) {
      authorId = userEntry.user_id;
    } else {
      console.warn(`Author ${author} not found in leagueTeamManagers.users`);
    }
  }
</script>

<style>
  .post {
    background-color: var(--fff);
    border: 1px solid var(--bbb);
    border-radius: 1.5em;
    color: var(--g333);
    padding: 1.5em 0 1em;
    margin: 2em 0;
  }
  h3 {
    font-size: 2em;
    text-align: center;
    margin: 0;
  }
  .button {
    background-color: #0082c3;
    font-size: 1em;
    border-radius: 1em;
    text-decoration: none;
    padding: 0.5em 1em;
    margin-right: 1em;
    color: white;
  }
  .button:hover {
    background-color: #00316b;
  }
  .body {
    position: relative;
    max-height: 9em;
    overflow: hidden;
  }
  .fade {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
  }
  .fadeTop {
    height: 2em;
    width: 100%;
    background-image: linear-gradient(to bottom, var(--fffTransparent), var(--fff));
  }
  .fadeBottom {
    height: 1em;
    width: 100%;
    background-color: var(--fff);
  }
  .viewFull {
    padding: 0.2em 2em 1em;
  }
  .divider {
    border:0;
    margin:0;
    width:100%;
    height:1px;
    background: var(--ddd);
    margin-bottom: 1em;
  }
</style>

{#if safePost}
  {#key id}
    <div
      in:fly={{ delay: duration, duration, x: 150 * direction }}
      out:fly={{ delay: 0, duration, x: -150 * direction }}
      class="post"
    >
      <h3>{title}</h3>

      <div class="body" bind:this={e} style="padding-bottom: {isOverflown ? '3em' : '0'}">
        {#each body.content as paragraph}
          {@html generateParagraph(paragraph)}
        {/each}

        {#if isOverflown}
          <div class="fade">
            <div class="fadeTop" />
            <div class="fadeBottom" />
          </div>
        {/if}
      </div>

      <div class="viewFull">
        <a class="button" href="/blog/{id}">View Full Post</a>
      </div>

      <hr class="divider" />

      {#if authorId}
        <AuthorAndDate {type} {leagueTeamManagers} {authorId} {createdAt} />
      {:else}
        <p style="text-align:center; color:red;">Author info not found</p>
      {/if}
    </div>
  {/key}
{/if}
