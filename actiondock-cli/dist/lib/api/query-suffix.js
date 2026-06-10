export function querySuffix(params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value) {
            search.set(key, value);
        }
    }
    const query = search.toString();
    return query ? `?${query}` : "";
}
