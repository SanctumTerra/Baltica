import * as fs from "node:fs";
import type { Cache } from 'prismarine-auth'  

//prismarine-auth uses 'any' instead of 'Record<string, unknown>' but fails linting

export class FileCache implements Cache {
  private cacheLocation: string
  private cache?: Record<string, unknown>

  constructor(cacheLocation: string) {
    this.cacheLocation = cacheLocation
  }

  async reset(): Promise<void> {
    this.cache = {}
    fs.writeFileSync(this.cacheLocation, JSON.stringify(this.cache))
  }

  private async loadInitialValue(): Promise<Record<string, unknown>> {
    try {
      return JSON.parse(fs.readFileSync(this.cacheLocation, 'utf8')) as Record<string, unknown>
    } catch {
      await this.reset()
      return {}
    }
  }

  async getCached(): Promise<Record<string, unknown>> {
    if (this.cache === undefined) {
      this.cache = await this.loadInitialValue()
    }
    return this.cache
  }

  async setCached(cached: Record<string, unknown>): Promise<void> {
    this.cache = cached
    fs.writeFileSync(this.cacheLocation, JSON.stringify(this.cache))
  }

  async setCachedPartial(cached: Record<string, unknown>): Promise<void> {
    await this.setCached({
      ...this.cache,
      ...cached
    })
  }
}
