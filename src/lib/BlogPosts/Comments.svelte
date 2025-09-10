<script>
    import { getAuthor, getAvatar, parseDate } from "$lib/utils/helper";
    import Icon from "@smui/textfield/icon";
    import CreateComment from "./CreateComment.svelte";
    import Dialog, { Title, Content, Actions } from '@smui/dialog';
    import Button, {Label} from "@smui/button";

    export let comments = [];
    export let total = 0;
    export let leagueTeamManagers;
    export let postID;

    let showWrite = false;
    let open = false;
    let errorMessage = '';

    // UI debug logs
    let uiLogs = [];
    const log = (msg) => {
        uiLogs = [...uiLogs, msg];
    };

    const addComment = async(e) => {
        try {
            log('addComment triggered');

            if (!e.detail) {
                log('❌ No detail found in event!');
                open = true;
                errorMessage = 'Internal error: event data missing';
                return;
            }

            const { comment, author } = e.detail;
            log(`Comment: "${comment}", Author: "${author}"`);

            if (comment.trim() === "") {
                errorMessage = 'Comment cannot be empty';
                open = true;
                log(`❌ ${errorMessage}`);
                return;
            }

            const validAuthor = validateID(author);
            log(`Valid Author ID: ${validAuthor}`);
            if (!validAuthor) {
                errorMessage = 'Unauthorized user';
                open = true;
                log(`❌ ${errorMessage}`);
                return;
            }

            const res = await fetch(`/api/addBlogComments/${validAuthor}`, {
                method: 'POST',
                body: JSON.stringify({
                    comment: comment.trim(),
                    postID
                })
            });

            const newComment = await res.json();
            log(`Fetch response: ${JSON.stringify(newComment)}`);

            if (!res.ok) {
                errorMessage = newComment;
                open = true;
                log(`❌ ${errorMessage}`);
                return;
            }

            comments = [...comments, newComment];
            total++;
            showWrite = false;
            log('✅ Comment added successfully');

        } catch(err) {
            open = true;
            errorMessage = 'Unexpected error: ' + err.message;
            log(`❌ ${errorMessage}`);
        }
    };

    const validateID = (author) => {
        log('validateID called');
        if (!leagueTeamManagers || !leagueTeamManagers.users) {
            log('❌ leagueTeamManagers.users missing');
            return false;
        }
        for(const userID in leagueTeamManagers.users) {
            if(leagueTeamManagers.users[userID].user_name.toLowerCase() === author.toLowerCase()) {
                return userID;
            }
        }
        return false;
    }
</script>

<style>
    .comment {
        margin: 0;
        padding: 1em 2em 0.5em;
        background: var(--eee);
        border: 1px solid var(--ccc);
        border-left: none;
        border-right: none;
    }
    
    .commentHeader {
        margin: 0;
        padding: 1em 2em;
        background: var(--f8f8f8);
        font-size: 1.2em;
        border-bottom: 1px solid var(--ccc);
        border-left: none;
        border-right: none;
    }

    .date {
        color: var(--g999);
        padding: 0.5em 0 0;
    }

    :global(.commentIcon) {
        font-size: 1em;
        vertical-align: middle;
        padding: 0.3em;
    }
	
	.teamAvatar {
		vertical-align: middle;
		border-radius: 50%;
		height: 30px;
		margin-right: 5px;
		border: 0.25px solid #777;
	}

    .author {
        font-weight: 700;
    }

    .debug-log {
        background: #ffe6e6;
        color: #900;
        padding: 0.5em;
        margin: 1em 0;
        font-family: monospace;
    }
</style>

<!-- Error dialog -->
<Dialog
  bind:open
  aria-labelledby="simple-title"
  aria-describedby="simple-content"
>
  <Title id="simple-title">Error</Title>
  <Content id="simple-content">{errorMessage}</Content>
  <Actions>
    <Button on:click={() => open = false}>
      <Label>Ok</Label>
    </Button>
  </Actions>
</Dialog>

<!-- Debug log UI -->
<div class="debug-log">
    <strong>Debug Logs:</strong>
    <ul>
        {#each uiLogs as l}
            <li>{l}</li>
        {/each}
    </ul>
</div>

<!-- Comments section -->
<div class="comments">
    <div class="commentHeader">
        <Icon class="material-icons commentIcon">comment</Icon> Comments ({total})
    </div>

    {#each comments as comment}
        <div class="comment">
            <img alt="author avatar" class="teamAvatar" src="{getAvatar(leagueTeamManagers, comment.fields.author)}" />
            <span class="author">{@html getAuthor(leagueTeamManagers, comment.fields.author)} - </span>
            <span class="commentText">{@html comment.fields.comment}</span>
            <div class="date"><i>{parseDate(comment.sys.createdAt)}</i></div>
        </div>
    {/each}

    <!-- Comment input -->
    <CreateComment bind:showWrite={showWrite} on:createComment={addComment}/>
</div>
