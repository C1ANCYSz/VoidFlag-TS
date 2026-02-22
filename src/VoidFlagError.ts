export class VoidFlagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoidFlagError';
  }
}
