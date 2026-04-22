"""Test management push subsystem.

Three pluggable clients (Xray Cloud, Zephyr Scale, native Jira ``Test``
issuetype) plus a Markdown parser that turns the test-case tables emitted
by the ``testcase`` / ``smoke`` / ``regression`` agents into a structured
list of test cases ready to be pushed.
"""

from core.test_management.parser import parse_testcases_markdown, TestCase
from core.test_management.xray_client import XrayClient
from core.test_management.zephyr_scale_client import ZephyrScaleClient

__all__ = [
    "parse_testcases_markdown",
    "TestCase",
    "XrayClient",
    "ZephyrScaleClient",
]
