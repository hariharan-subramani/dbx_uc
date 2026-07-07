import os
import traceback
from dotenv import load_dotenv
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState

load_dotenv()

w = WorkspaceClient(
    host=os.getenv("DATABRICKS_HOST"),
    token=os.getenv("DATABRICKS_TOKEN")
)

def list_catalogs():
    try:
        catalogs = [c.name for c in w.catalogs.list()]

        return {
            "success": True,
            "catalogs": catalogs
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc()
        }

def list_schemas(catalog_name):
    try:
        schemas = [
            {
                "name": schema.name,
                "catalog_name": schema.catalog_name,
                "comment": schema.comment,
            }
            for schema in w.schemas.list(catalog_name=catalog_name)
        ]

        return {
            "success": True,
            "catalog": catalog_name,
            "schemas": schemas,
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc()
        }

def list_tables(catalog_name, schema_name):
    try:
        tables = [
            {
                "name": table.name,
                "catalog_name": table.catalog_name,
                "schema_name": table.schema_name,
                "table_type": str(table.table_type.value if table.table_type else "TABLE"),
                "comment": table.comment,
            }
            for table in w.tables.list(
                catalog_name=catalog_name,
                schema_name=schema_name,
            )
        ]

        return {
            "success": True,
            "catalog": catalog_name,
            "schema": schema_name,
            "tables": tables,
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc()
        }

def preview_table_data(catalog_name, schema_name, table_name, limit=25):
    try:
        warehouses = list(w.warehouses.list())
        if not warehouses:
            return {
                "success": False,
                "error": "No SQL warehouse is available in this workspace.",
            }

        running = next(
            (
                warehouse
                for warehouse in warehouses
                if str(warehouse.state).upper().endswith("RUNNING")
            ),
            None,
        )
        warehouse = running or warehouses[0]

        def quote_identifier(value):
            return f"`{value.replace('`', '``')}`"

        full_table_name = ".".join(
            quote_identifier(value)
            for value in (catalog_name, schema_name, table_name)
        )
        response = w.statement_execution.execute_statement(
            statement=f"SELECT * FROM {full_table_name} LIMIT {limit}",
            warehouse_id=warehouse.id,
            wait_timeout="30s",
        )

        state = response.status.state if response.status else None
        if state != StatementState.SUCCEEDED:
            message = (
                response.status.error.message
                if response.status and response.status.error
                else f"Query did not complete successfully ({state})."
            )
            return {"success": False, "error": message}

        columns = []
        if response.manifest and response.manifest.schema:
            columns = [
                {
                    "name": column.name,
                    "type": column.type_text or str(column.type_name or ""),
                }
                for column in (response.manifest.schema.columns or [])
            ]

        rows = response.result.data_array if response.result else []
        return {
            "success": True,
            "catalog": catalog_name,
            "schema": schema_name,
            "table": table_name,
            "warehouse_id": warehouse.id,
            "columns": columns,
            "rows": rows or [],
            "limit": limit,
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc(),
        }
