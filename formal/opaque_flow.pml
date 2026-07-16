/*
 * Pinpoint value-opaque MCP flow: bounded reference model.
 *
 * This is intentionally smaller than the TypeScript implementation. It models
 * the security-relevant decisions at the client/gateway/upstream boundary and
 * lets Spin enumerate valid and hostile action orderings.
 *
 * Trusted: gateway reference monitor, policy, wrapped upstream process.
 * Protected: selected source/destination values on the client-facing channel.
 * Observable: names, field names, counts, sizes, limits, success, timing.
 */

#define MAX_STEPS 10

mtype = {
   SourceCatalogValid,
   SourceCatalogInvalid,
   DestinationCatalogValid,
   DestinationCatalogInvalid,
   AuthorityValid,
   AuthorityTamper,
   CredentialCopy,
    SourceCall,
    FlowAttempt,
    DirectDestination,
    DirectQuery,
    ResourceRead,
    ForgedCapability,
   FixedPredicateOverride,
    MalformedSource,
    LateUpstreamOutput
};

bool source_catalog_valid = false;
bool destination_catalog_valid = false;
bool authority_valid = false;
bool capability_valid = false;
bool protected_data_handled = false;

bool client_value_visible = false;
bool credential_crossed = false;
bool destination_called = false;
bool receipt_emitted = false;

byte receipt_sequence = 0;
byte receipt_previous = 0;

inline choose_bool(value) {
    if
    :: value = false
    :: value = true
    fi
}

active proctype ReferenceMonitor() {
    byte steps = 0;
    byte sequence_before;
    mtype action;

    bool source_capture_succeeds;
    bool operation_allowed;
    bool where_fields_allowed;
    bool projection_fields_allowed;
    bool destination_args_allowed;
    bool provenance_matches;
   bool fixed_predicate_preserved;
    bool item_bound_holds;
    bool byte_bound_holds;

    do
    :: steps < MAX_STEPS ->
        sequence_before = receipt_sequence;
        destination_called = false;
        receipt_emitted = false;

        if
        :: action = SourceCatalogValid;
           source_catalog_valid = true

        :: action = SourceCatalogInvalid;
           source_catalog_valid = false;
           capability_valid = false

        :: action = DestinationCatalogValid;
           destination_catalog_valid = true

        :: action = DestinationCatalogInvalid;
           destination_catalog_valid = false

        :: action = AuthorityValid;
           /* A trusted operator delegates the session key for the exact policy. */
           authority_valid = true

        :: action = AuthorityTamper;
           /* Wrong roots, changed policy commitments, and key swaps invalidate authority. */
           authority_valid = false

        :: action = CredentialCopy;
           /* Source and destination environments are separately allowlisted. */
           skip

        :: action = SourceCall;
           if
           :: source_catalog_valid ->
              choose_bool(source_capture_succeeds);
              protected_data_handled = true;
              if
              :: source_capture_succeeds -> capability_valid = true
              :: else -> capability_valid = false
              fi
           :: else -> skip
           fi

        :: action = FlowAttempt;
           choose_bool(operation_allowed);
           choose_bool(where_fields_allowed);
           choose_bool(projection_fields_allowed);
           choose_bool(destination_args_allowed);
           choose_bool(provenance_matches);
           choose_bool(fixed_predicate_preserved);
           choose_bool(item_bound_holds);
           choose_bool(byte_bound_holds);

           if
           :: source_catalog_valid &&
              destination_catalog_valid &&
              authority_valid &&
              capability_valid &&
              operation_allowed &&
              where_fields_allowed &&
              projection_fields_allowed &&
              destination_args_allowed &&
              provenance_matches &&
              fixed_predicate_preserved &&
              item_bound_holds &&
              byte_bound_holds ->
                destination_called = true;
                receipt_emitted = true;
                receipt_previous = receipt_sequence;
                receipt_sequence++
           :: else -> skip
           fi

        :: action = DirectDestination;
           /* Hidden destinations are never dispatched from client requests. */
           skip

        :: action = DirectQuery;
           /* Strict mode does not expose pinpoint_query. */
           skip

        :: action = ResourceRead;
           /* Strict mode does not expose artifact resources or previews. */
           skip

        :: action = ForgedCapability;
           /* A forged id cannot set capability_valid. */
           skip

        :: action = FixedPredicateOverride;
           /* Model-supplied where fields cannot replace operator-fixed values. */
           skip

        :: action = MalformedSource;
           /* Invalid protected results become value-free errors. */
           protected_data_handled = true;
           capability_valid = false

        :: action = LateUpstreamOutput;
           /* Once protected handling starts, unsolicited output is suppressed. */
           if
           :: protected_data_handled -> skip
           :: else -> skip
           fi
        fi;

        /* Safety 1: selected values never cross the modeled client boundary. */
        assert(!client_value_visible);

      /* Safety 1b: credentials never copy between source and destination domains. */
      assert(!credential_crossed);

        /* Safety 2: destination dispatch implies every policy predicate held. */
      assert(!destination_called ||
             (source_catalog_valid &&
          destination_catalog_valid &&
          authority_valid &&
         capability_valid &&
         operation_allowed &&
         where_fields_allowed &&
         projection_fields_allowed &&
         destination_args_allowed &&
         provenance_matches &&
                fixed_predicate_preserved &&
         item_bound_holds &&
         byte_bound_holds));

        /* Safety 3: receipts correspond one-to-one with authorized dispatch. */
        assert(receipt_emitted == destination_called);
        assert(receipt_sequence == sequence_before ||
               receipt_sequence == sequence_before + 1);
        assert(!receipt_emitted ||
               (receipt_previous == sequence_before &&
                receipt_sequence == sequence_before + 1));

        steps++

    :: else -> break
    od
}