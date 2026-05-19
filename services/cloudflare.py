import httpx
from typing import Optional


class CloudflareService:
    BASE_URL = "https://api.cloudflare.com/client/v4"

    def __init__(self, api_token: str, zone_id: str):
        self.zone_id = zone_id
        self.headers = {
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        }

    async def _request(self, method: str, path: str, **kwargs):
        async with httpx.AsyncClient() as client:
            response = await client.request(
                method,
                f"{self.BASE_URL}{path}",
                headers=self.headers,
                timeout=15.0,
                **kwargs,
            )
            return response.json()

    async def verify_token(self):
        return await self._request("GET", "/user/tokens/verify")

    async def get_zone_info(self):
        return await self._request("GET", f"/zones/{self.zone_id}")

    async def list_records(self, record_type: Optional[str] = None, name: Optional[str] = None):
        params = {"per_page": 100}
        if record_type:
            params["type"] = record_type
        if name:
            params["name"] = name
        return await self._request("GET", f"/zones/{self.zone_id}/dns_records", params=params)

    async def create_record(self, record_type: str, name: str, content: str,
                            ttl: int = 1, proxied: bool = False, priority: Optional[int] = None):
        payload = {
            "type": record_type,
            "name": name,
            "content": content,
            "ttl": ttl,
            "proxied": proxied,
        }
        if priority is not None and record_type == "MX":
            payload["priority"] = priority
        return await self._request("POST", f"/zones/{self.zone_id}/dns_records", json=payload)

    async def update_record(self, record_id: str, record_type: str, name: str,
                            content: str, ttl: int = 1, proxied: bool = False,
                            priority: Optional[int] = None):
        payload = {
            "type": record_type,
            "name": name,
            "content": content,
            "ttl": ttl,
            "proxied": proxied,
        }
        if priority is not None and record_type == "MX":
            payload["priority"] = priority
        return await self._request("PUT", f"/zones/{self.zone_id}/dns_records/{record_id}", json=payload)

    async def delete_record(self, record_id: str):
        return await self._request("DELETE", f"/zones/{self.zone_id}/dns_records/{record_id}")