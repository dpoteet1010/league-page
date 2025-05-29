<script>
	import { getTeamFromTeamManagers } from '$lib/utils/helperFunctions/universalFunctions';

	export let move, leagueTeamManagers, players, season;

	const getAvatar = (pos, player) => {
		if (pos == 'DEF') {
			return `background-image: url(https://sleepercdn.com/images/team_logos/nfl/${player.toLowerCase()}.png)`;
		}
		return `background-image: url(https://sleepercdn.com/content/nfl/players/thumb/${player}.jpg), url(https://sleepercdn.com/images/v2/icons/player_default.webp)`;
	};

	let origin, dest;

	for (let i = 0; i < move.length; i++) {
		if (move[i] && move[i] == "origin") origin = i;
		if (move[i] && (move[i].pick || move[i].player || move[i].budget)) {
			dest = i;
		}
	}

	const checkL = (cell, ix) => {
		if (!cell) {
			if (ix < origin && ix < dest) return true;
			if (ix > origin && ix > dest) return true;
			return false;
		}
		if (ix == origin) {
			return dest > origin;
		}
		return ix < origin;
	};

	const checkR = (cell, ix) => {
		if (!cell) {
			if (ix < origin && ix < dest) return true;
			if (ix > origin && ix > dest) return true;
			return false;
		}
		if (ix == origin) {
			return dest < origin;
		}
		return ix > origin;
	};

	const getNumEnd = (num) => {
		switch (num) {
			case 1: return "st";
			case 2: return "nd";
			case 3: return "rd";
			default: return "th";
		}
	};
</script>

<style>
	/* [unchanged styles trimmed for brevity] */

	.indicator.add {
		color: #00ceb8; /* green */
	}

	.indicator.remove {
		color: #e74c3c; /* red */
	}
</style>

<tr>
	{#each move as cell, ix}
		<td class="move">
			<div class="cellParent">
				<div class="line lineL {checkL(cell, ix) ? 'hidden' : ''}" />
				<div class="line lineR {checkR(cell, ix) ? 'hidden' : ''}" />

				{#if cell && cell.player}
					<div class="playerSlot">
						<div class="tradeSlot playerAvatar" style="border-color: var(--{players[cell.player].pos}); {getAvatar(players[cell.player].pos, cell.player)}">
							<i class="indicator material-icons {ix === origin ? 'remove' : 'add'}" aria-hidden="true">
								{ix === origin ? 'remove_circle' : 'add_circle'}
							</i>
						</div>
						<div class="nameHolder">
							<span class="name">{`${players[cell.player].fn} ${players[cell.player].ln}`}</span>
							<span class="playerInfo">
								<span>{players[cell.player].pos}</span>
								{#if players[cell.player].t}
									- <span>{players[cell.player].t}</span>
								{/if}
							</span>
						</div>
					</div>

				{:else if cell && cell.pick}
					<div class="playerSlot">
						<div class="avatarHolder">
							<div class="tradeSlot pick">
								<span class="round">Round</span>
								<span class="pickInfo">
									{cell.pick.round}<span class="numEnd">{getNumEnd(cell.pick.round)}</span>
								</span>
								<i class="indicator material-icons {ix === origin ? 'remove' : 'add'}" aria-hidden="true">
									{ix === origin ? 'remove_circle' : 'add_circle'}
								</i>
							</div>
						</div>
						<div class="pickNameHolder">
							<span class="year">{cell.pick.season}</span>
							{#if cell.pick.original_owner}
								<span class="originalOwner">
									{getTeamFromTeamManagers(leagueTeamManagers, cell.pick.original_owner, season).name}
									{getTeamFromTeamManagers(leagueTeamManagers, cell.pick.original_owner, season).name != getTeamFromTeamManagers(leagueTeamManagers, cell.pick.original_owner).name
										? ` (${getTeamFromTeamManagers(leagueTeamManagers, cell.pick.original_owner).name})` : ''}
								</span>
							{/if}
						</div>
					</div>

				{:else if cell && cell.budget}
					<div class="playerSlot">
						<div class="avatarHolder">
							<div class="tradeSlot budgetHolder">
								<span class="budget">faab</span>
								<span class="pickInfo">
									{cell.budget.amount}<span class="numEnd">$</span>
								</span>
								<i class="indicator material-icons {ix === origin ? 'remove' : 'add'}" aria-hidden="true">
									{ix === origin ? 'remove_circle' : 'add_circle'}
								</i>
							</div>
						</div>
					</div>

				{:else if cell && cell == 'origin'}
					<div class="playerSlot">
						<div class="avatarHolder">
							<div class="tradeSlot origin">
								{#if dest - origin < 0}
									<i class="direction material-icons" aria-hidden="true">chevron_left</i>
								{:else}
									<i class="direction material-icons" aria-hidden="true">chevron_right</i>
								{/if}
							</div>
						</div>
					</div>
				{/if}
			</div>
		</td>
	{/each}
</tr>
