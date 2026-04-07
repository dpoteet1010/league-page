export const getNflState = async () => {
    const res = await fetch(`https://api.sleeper.app/v1/state/nfl`, { compress: true });
    
    if (!res.ok) {
        throw new Error("Failed to fetch NFL State from Sleeper");
    }

    const data = await res.json();
    return data;
}
