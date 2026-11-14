from typing import Protocol


class AccessPolicy(Protocol):
    def check_access(self, subject_id: str, capability: str) -> bool: ...


class NoBillingAccessPolicy:
    def check_access(self, subject_id: str, capability: str) -> bool:
        return capability in {"assessment", "daily_training"}
