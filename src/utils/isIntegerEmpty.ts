
export const isIntegerEmpty = async (value: number | undefined | null): Promise <boolean> => {
    const result = value === undefined || value === null || value === 0;

    return result
}