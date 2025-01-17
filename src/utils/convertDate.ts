const monthAbbreviations = [
    "Jan", 
    "Feb", 
    "Mar", 
    "Apr", 
    "May", 
    "Jun", 
    "Jul", 
    "Aug", 
    "Sep", 
    "Oct", 
    "Nov", 
    "Dec"
];

export function convertDate(dateString: string) {
    // Split the input date string into day, month, and year
    const [day, month, year] = dateString.split("/");

    // Get the abbreviated month name (convert month to zero-based index)
    const abbreviatedMonth = monthAbbreviations[parseInt(month, 10) - 1];

    // Return the formatted date
    return `${day}-${abbreviatedMonth}-${year}`;
}  

export function getCurrentTimestamp(): string {
    const now = new Date();
    return now.toISOString();
}