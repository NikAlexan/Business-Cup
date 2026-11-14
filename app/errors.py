from typing import NoReturn


class ApiError(Exception):
    def __init__(self, status, code, message, details=None):
        self.status, self.code, self.message = status, code, message
        self.details = details or {}
        super().__init__(message)


def fail(status, code, message, details=None) -> NoReturn:
    raise ApiError(status, code, message, details)
