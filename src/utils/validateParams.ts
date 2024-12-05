export const validateRequiredParams = (params: Record<string, any>, requiredFields: string[]) => {
    const missingFields = requiredFields.filter((field) => !params[field]);
    if (missingFields.length > 0) {
      throw new Error(`Mandatory Property Missing: ${missingFields.join(", ")}`);
    }
};
  