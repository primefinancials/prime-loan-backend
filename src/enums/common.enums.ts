enum EUserStatus {
    ACTIVE = "active",
    PENDING = "pending",
};
enum EDeviceStatus {
    ACTIVE = "active",
    PENDING = "pending",
};
// Helper code for the API consumer to understand the error and handle it accordingly
enum EStatusCode {
    OK = '10000',
    CREATED = '10001',
    NO_CONTENT = '10002',
    FAILURE = '10003',
    RETRY = '10004',
    INVALID_ACCESS_TOKEN = '10005',
};

// Response status codes
enum EResponseStatus {
    OK = 200,
    CREATED = 201,
    NO_CONTENT = 204,
    BAD_REQUEST = 400,
    UN_AUTHORISED = 401,
    FORBIDDEN = 403,
    NOT_FOUND = 404,
    NO_ENTRY = 404,
    CONFLICT = 409,
    ENTITY_TOO_LARGE = 413,
    UNPROCESSABLE_ENTITY = 422,
    RATE_LIMIT_EXCEEDED = 429,
    INTERNAL_ERROR = 500,
};

enum ERequestFileType {
    IMAGE = 'image',
    VIDEO = 'video',
    AUDIO = 'audio',
    DOCUMENT = 'document',
    OTHER = 'other',
};

enum ERequestFileQuality {
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
};

enum ERequestFileQuantity {
    SINGLE = 'single',
    MULTIPLE = 'multiple',
};


export {
    EStatusCode,
    EUserStatus,
    EDeviceStatus,
    EResponseStatus,
    ERequestFileType,
    ERequestFileQuality,
    ERequestFileQuantity,
};