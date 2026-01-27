/**
 * Helper to determine collection name based on environment.
 * Appends '_staging' if NODE_ENV is 'dev'.
 */
export const getCollectionName = (name: string): string => {
    return process.env.NODE_ENV === 'dev' ? `${name}_staging` : name;
};
