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

    const addComment = async(e) => {
        try {
            if (!e.detail) {
                open = true;
                errorMessage = 'Internal error: event data missing';
                return;
            }

            const { comment, author } = e.detail;

            if (comment.trim() === "") {
                errorMessage = 'Comment cannot be empty';
                open = true;
                return;
            }

            const validAuthor = validateID(author);
            if (!validAuthor) {
                errorMessage = 'Unauthorized user';
                open = true;
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

            if (!res.ok) {
                errorMessage = newComment;
                open = true;
                return;
            }

            comments = [...comments, newComment];
            total++;
            showWrite = false;

        } catch(err) {
            open = true;
            errorMessage = 'Unexpected error: ' + err.message;
        }
    };

    const validateID = (author) => {
        if (!leagueTeamManagers?.users || !author) return false;

        const auth = author.trim().toLowerCase();

        for (const uID in leagueTeamManagers.users) {
            const user = leagueTeamManagers.users[uID];
            if (!user) continue;

            const uname = user.user_name?.trim().toLowerCase();
            const dname = user.display_name?.trim().toLowerCase();

            if (uname === auth || dname === auth) return uID;
        }

        return false;
    };
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
