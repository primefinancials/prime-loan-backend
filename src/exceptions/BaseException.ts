export default abstract class BaseException extends Error {
  public message = "";

  private error: any;
  constructor(message: string) {
    super(message);
  }
  refineException(error: Error | any) {
    this.error = error;

    return this
  }

  protected isGaxiosError = () => "GaxiosError" === this.error.constructor.name;
  protected isNetworkError = () => this.error.message.includes("getaddrinfo");
}
