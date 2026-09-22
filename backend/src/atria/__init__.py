"""Atria Rev B backend.

Layers, innermost first:

    core    pure domain rules. No boto3, no environment, no I/O.
    data    the single table repository and key builders.
    http    API Gateway request and response handling shared by every service.
    services  one package per Lambda service, each with a handler entry point.

A service may import inwards only: services use http, data and core; data uses
core; core uses nothing but the specification in atria_spec.
"""

__version__ = "0.1.0"
